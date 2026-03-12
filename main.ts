import cron from 'node-cron';
import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { buildSlackMessage, loadGootuApiData, shouldPostMenu } from './gootu-api.ts';
import { saveApiSnapshot } from './snapshots.ts';

dotenv.config();

const LAST_POST_FILE = path.join(process.cwd(), 'last_post.json');
const CHECK_START_HOUR = 9;
const CHECK_END_HOUR = 12;

interface LastPost {
  date: string;
  message: string;
}

const parseArgs = async () => {
  const argv = await yargs(hideBin(process.argv))
    .option('force', {
      alias: 'f',
      type: 'boolean',
      description: 'Force menu check regardless of time',
      default: false
    })
    .option('date', {
      alias: 'd',
      type: 'string',
      description: 'Simulate a specific date (format: DD/MM/YYYY)',
      coerce: (rawDate: string) => {
        if (!rawDate) {
          return undefined;
        }

        const parts = rawDate.split('/');
        if (parts.length !== 3) {
          throw new Error('Invalid date format. Use DD/MM/YYYY');
        }

        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const date = new Date(year, month, day);

        if (
          Number.isNaN(date.getTime()) ||
          date.getDate() !== day ||
          date.getMonth() !== month ||
          date.getFullYear() !== year
        ) {
          throw new Error('Invalid date. Please enter a valid date in format DD/MM/YYYY');
        }

        return date;
      }
    })
    .help()
    .parse();

  return argv;
};

const argv = await parseArgs();

async function hasPostedToday(date: Date = new Date()): Promise<boolean> {
  try {
    const content = await fs.readFile(LAST_POST_FILE, 'utf-8');
    const lastPost: LastPost = JSON.parse(content);
    const targetDate = date.toISOString().split('T')[0];
    return lastPost.date === targetDate;
  } catch {
    return false;
  }
}

async function saveLastPost(message: string, date: Date = new Date()): Promise<void> {
  const lastPost: LastPost = {
    date: date.toISOString().split('T')[0],
    message
  };

  await fs.writeFile(LAST_POST_FILE, JSON.stringify(lastPost, null, 2));
}

async function getChannelId(slack: WebClient, channelName: string): Promise<string | null> {
  try {
    const name = channelName.replace(/^#/, '');

    if (name.match(/^[CGDZ][A-Z0-9]{8,}$/)) {
      return name;
    }

    const result = await slack.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000
    });

    if (!result.ok) {
      throw new Error(`Failed to list channels: ${result.error}`);
    }

    const channel = result.channels?.find((candidate) => candidate.name === name);
    if (!channel) {
      throw new Error(`Channel "${name}" not found. Make sure the bot is invited to the channel.`);
    }

    return channel.id || null;
  } catch (error) {
    console.error('Error getting channel ID:', error);
    return null;
  }
}

async function notifySlack(message: string): Promise<boolean> {
  if (!process.env.SLACK_TOKEN || !process.env.SLACK_CHANNEL) {
    console.log('Slack configuration missing, skip posting');
    return false;
  }

  const slack = new WebClient(process.env.SLACK_TOKEN);

  try {
    const channelId = await getChannelId(slack, process.env.SLACK_CHANNEL);
    if (!channelId) {
      return false;
    }

    await slack.chat.postMessage({
      channel: channelId,
      text: message
    });

    return true;
  } catch (error) {
    console.error('Error sending Slack message:', error);
    return false;
  }
}

async function fetchAndSnapshotMenu(now: Date) {
  const apiData = await loadGootuApiData(now);
  const snapshotDirectory = await saveApiSnapshot({
    targetDate: apiData.targetDate,
    categories: apiData.categories,
    catalog: apiData.catalog,
    menus: apiData.menus,
    menuDetail: apiData.menuDetail
  }, now);

  console.log(`Snapshot saved to ${snapshotDirectory}`);
  return apiData;
}

async function checkMenu(force = false, simulatedDate?: Date) {
  const now = simulatedDate ?? new Date();
  const currentHour = now.getHours();

  if (!force && (currentHour < CHECK_START_HOUR || currentHour >= CHECK_END_HOUR)) {
    console.log(`Outside of checking hours (${CHECK_START_HOUR}h-${CHECK_END_HOUR}h), skipping check`);
    return;
  }

  console.log(
    `Checking gootu API for ${now.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })}${force ? ' (forced check)' : ''}...`
  );

  try {
    const apiData = await fetchAndSnapshotMenu(now);

    if (!shouldPostMenu(apiData.sections, apiData.isOpenDay)) {
      console.log('No plat du jour found in API data, nothing is posted to Slack');
      return;
    }

    if (!force && await hasPostedToday(now)) {
      console.log('Menu has already been posted for this date, snapshot kept and Slack skipped');
      return;
    }

    const message = buildSlackMessage(now, apiData.sections);
    const isPosted = await notifySlack(message);

    if (!isPosted) {
      console.log('Slack message was not sent');
      return;
    }

    await saveLastPost(message, now);
    console.log('Menu posted to Slack successfully');
  } catch (error) {
    console.error('Error while checking menu:', error);
  }
}

if (argv.force || argv.date) {
  checkMenu(argv.force, argv.date as Date);
} else {
  cron.schedule('*/15 9-11 * * *', () => {
    checkMenu();
  });

  const currentHour = new Date().getHours();
  if (currentHour >= CHECK_START_HOUR && currentHour < CHECK_END_HOUR) {
    checkMenu();
  }

  console.log('Menu scraper started. Waiting for scheduled checks (every 15 minutes from 9h to 11h45)...');
}
