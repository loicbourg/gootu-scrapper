import puppeteer from 'puppeteer';
import cron from 'node-cron';
import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

// Load environment variables
dotenv.config();

// Constants
const LAST_POST_FILE = path.join(process.cwd(), 'last_post.json');

const FACEBOOK_URL = 'https://www.facebook.com/gooturestaurant/?locale=fr_FR';

interface MenuData {
  text: string | null;
  imageUrl: string | null;
}

async function getTodayMenu(): Promise<MenuData | null> {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Navigate to the Facebook page
    await page.goto(FACEBOOK_URL, { waitUntil: 'networkidle0' });

    // Accept cookies if the dialog appears
    try {
      const cookieButton = await page.waitForSelector('[data-testid="cookie-policy-manage-dialog-accept-button"]', { timeout: 5000 });
      if (cookieButton) {
        await cookieButton.click();
        await page.waitForNavigation({ waitUntil: 'networkidle0' });
      }
    } catch (e) {
      console.log('No cookie dialog found or already accepted');
    }

    // Get today's date in French format
    const today = new Date().toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    // Get all posts
    const posts = await page.$$('div[role="article"]');
    let menuData: MenuData = { text: null, imageUrl: null };

    // Look for today's menu in recent posts
    for (const post of posts) {
      const text = await post.evaluate(el => {
        const messageEl = el.querySelector('[data-ad-preview="message"]');
        return messageEl ? messageEl.textContent : '';
      });

      if (text && (
        text.toLowerCase().includes('menu') ||
        text.toLowerCase().includes('aujourd\'hui') ||
        text.toLowerCase().includes(today.toLowerCase())
      )) {
        // Found the menu post, now get the image
        const imageElement = await post.$('a[role="link"] img');
        if (imageElement) {
          const imageUrl = await imageElement.evaluate(img => img.src);
          menuData = {
            text: text,
            imageUrl: imageUrl
          };
          break;
        }
      }
    }

    await browser.close();
    return menuData;

  } catch (error) {
    console.error('Error fetching menu:', error);
    return null;
  }
}

async function downloadImage(url: string): Promise<string> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Get the image as a buffer
  const response = await page.goto(url);
  const buffer = await response!.buffer();
  
  // Create images directory if it doesn't exist
  const imageDir = path.join(process.cwd(), 'images');
  await fs.mkdir(imageDir, { recursive: true });
  
  // Save image with timestamp
  const fileName = `menu-${Date.now()}.jpg`;
  const filePath = path.join(imageDir, fileName);
  await fs.writeFile(filePath, buffer);
  
  await browser.close();
  return filePath;
}

async function getChannelId(slack: WebClient, channelName: string): Promise<string | null> {
  try {
    // Remove the # if it exists at the start of the channel name
    const name = channelName.replace(/^#/, '');
    
    // First, try to treat the input as a direct channel ID
    if (name.match(/^[CGDZ][A-Z0-9]{8,}$/)) {
      console.log('Input appears to be a valid channel ID, using it directly');
      return name;
    }

    console.log(`Looking for channel with name: ${name}`);
    
    // Get the list of all conversations (channels) the bot has access to
    const result = await slack.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000 // Get more channels in one request
    });
    
    if (!result.ok) {
      throw new Error(`Failed to list channels: ${result.error}`);
    }

    const channel = result.channels?.find(c => c.name === name);
    
    if (!channel) {
      // Log available channels to help debugging
      console.log('Available channels:', result.channels?.map(c => c.name).join(', '));
      throw new Error(`Channel "${name}" not found. Make sure the bot is invited to the channel.`);
    }
    
    console.log(`Found channel ID for ${name}: ${channel.id}`);
    return channel.id || null;
    
  } catch (error) {
    console.error('Error getting channel ID:', error);
    if (error instanceof Error) {
      console.log('Error details:', error.message);
    }
    return null;
  }
}

async function notifySlack(menuData: MenuData) {
  if (!process.env.SLACK_TOKEN || !process.env.SLACK_CHANNEL) {
    console.log('Slack configuration missing');
    return;
  }

  const slack = new WebClient(process.env.SLACK_TOKEN);
  
  try {
    if (!menuData.imageUrl) {
      console.log('No menu image found');
      return;
    }

    // Get the channel ID
    const channelId = await getChannelId(slack, process.env.SLACK_CHANNEL);
    if (!channelId) {
      console.error('Could not find channel:', process.env.SLACK_CHANNEL);
      return;
    }

    // Download the image
    const imagePath = await downloadImage(menuData.imageUrl);
    
    // Upload the image to Slack using the new V2 method
    const uploadResponse = await slack.files.uploadV2({
      channel_id: channelId,
      file: await fs.readFile(imagePath),
      filename: 'menu-du-jour.jpg',
      title: 'Menu du jour',
      initial_comment: '🍽️ Menu du jour chez Gootu'
    });

    // Delete the temporary image file
    await fs.unlink(imagePath);
    
  } catch (error) {
    console.error('Error sending Slack message:', error);
  }
}

interface LastPost {
  date: string;
  imageUrl: string;
}

async function hasPostedToday(): Promise<boolean> {
  try {
    const content = await fs.readFile(LAST_POST_FILE, 'utf-8');
    const lastPost: LastPost = JSON.parse(content);
    const today = new Date().toISOString().split('T')[0];
    return lastPost.date === today;
  } catch {
    return false;
  }
}

async function saveLastPost(imageUrl: string): Promise<void> {
  const lastPost: LastPost = {
    date: new Date().toISOString().split('T')[0],
    imageUrl: imageUrl
  };
  await fs.writeFile(LAST_POST_FILE, JSON.stringify(lastPost, null, 2));
}

async function checkMenu() {
  const currentHour = new Date().getHours();
  
  // Only check between 9h and 12h
//   if (currentHour < 9 || currentHour >= 12) {
    console.log('Outside of checking hours (9h-12h), skipping check');
    // return;
//   }

  // Check if we already posted today
  if (await hasPostedToday()) {
    console.log('Menu has already been posted today, skipping');
    return;
  }

  console.log('Checking today\'s menu...');
  const menuData = await getTodayMenu();
  
  if (menuData && menuData.imageUrl) {
    console.log('Menu found with image:', menuData.imageUrl);
    await notifySlack(menuData);
    // Save the fact that we posted today
    await saveLastPost(menuData.imageUrl);
  } else {
    console.log('No menu or image found for today');
  }
}

// Schedule the task to run every hour from 9h to 12h
cron.schedule('0 9-12 * * *', checkMenu);

// Initial check when starting the script (only if within hours)
const currentHour = new Date().getHours();
// if (currentHour >= 9 && currentHour < 12) {
  checkMenu();
// }

console.log('Menu scraper started. Waiting for scheduled checks (every hour from 9h to 12h)...');
