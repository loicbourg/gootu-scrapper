import puppeteer, { Browser } from 'puppeteer';
import cron from 'node-cron';
import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Load environment variables
dotenv.config();

// Parse command line arguments
const parseArgs = async () => {
  const argv = await yargs(hideBin(process.argv))
    .option('force', {
      alias: 'f',
      type: 'boolean',
      description: 'Force menu check regardless of time',
      default: false
    })
    .option('visible', {
      alias: 'v',
      type: 'boolean',
      description: 'Run in visible mode (non-headless browser)',
      default: false
    })
    .option('date', {
      alias: 'd',
      type: 'string',
      description: 'Simulate a specific date (format: DD/MM/YYYY)',
      coerce: (d: string) => {
        if (!d) return undefined;
        // Parse French date format DD/MM/YYYY
        const parts = d.split('/');
        if (parts.length !== 3) {
          throw new Error('Invalid date format. Use DD/MM/YYYY');
        }
        
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // months are 0-based in JavaScript
        const year = parseInt(parts[2], 10);
        
        const date = new Date(year, month, day);
        
        // Validate the date
        if (isNaN(date.getTime()) || 
            date.getDate() !== day || 
            date.getMonth() !== month || 
            date.getFullYear() !== year) {
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

// Constants
const LAST_POST_FILE = path.join(process.cwd(), 'last_post.json');

const FACEBOOK_URL = 'https://www.facebook.com/gooturestaurant/?locale=fr_FR';

interface MenuData {
  text: string | null;
  imageUrl: string | null;
  postDate?: Date;
}

async function waitIfVisible(browser: Browser, visible: boolean) {
  if (visible) {
    console.log('Browser will stay open for 30 seconds for inspection...');
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

async function getTodayMenu(targetDate: Date = new Date()): Promise<MenuData | null> {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: !argv.visible,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ],
      defaultViewport: {
        width: 1920,
        height: 1080
      }
    });

    const page = await browser.newPage();
    
    // Navigate to the Facebook page
    await page.goto(FACEBOOK_URL, { waitUntil: 'networkidle0' });

    // Accept cookies if the dialog appears
    try {
      console.log('Looking for cookie consent dialog...');
      
      // Liste de sélecteurs possibles pour le bouton d'acceptation des cookies
      const cookieSelectors = [
        'span.x1lliihq.x6ikm8r.x10wlt62.x1n2onr6.xlyipyv.xuxw1ft',
        '::-p-text(Autoriser tous les cookies)',
        '[aria-label="Autoriser tous les cookies"]',
        'div[role="button"] span.x1lliihq',
        '[data-testid="cookie-policy-manage-dialog-accept-button"]',
        '[data-testid="cookie-policy-dialog-accept-button"]',
        '[title="Autoriser tous les cookies"]',
        '[title="Autoriser les cookies essentiels et optionnels"]',
        'button[type="submit"]:has-text("Autoriser tous les cookies")',
        'button:has-text("Autoriser tous les cookies")',
      ];

      // Attendre que le dialogue des cookies apparaisse
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Essayer chaque sélecteur
      for (const selector of cookieSelectors) {
        console.log(`Trying cookie button selector: ${selector}`);
        try {
          const cookieButton = await page.waitForSelector(selector, { timeout: 1000 });
          if (cookieButton) {
            console.log(`Found cookie button with selector: ${selector}`);
            await cookieButton.click();
            console.log('Clicked cookie button, waiting for navigation...');
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {
              console.log('No navigation occurred after clicking cookie button');
            });
            console.log('Cookie consent handled');
            break;
          }
        } catch (selectorError) {
          console.log(`Selector ${selector} not found`);
        }
      }
    } catch (e) {
      console.log('Could not handle cookie consent:', e);
    }

    // Handle login dialog close button
    try {
      console.log('Looking for login dialog close button...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for dialog to appear

      const closeButtonSelectors = [
        'i.x1b0d499.x1d69dk1[style*="background-position: 0px -402px"]',
        '[aria-label="Fermer"]',
        '[aria-label="Close"]',
        'div[role="button"][class*="x1i10hfl"]',
        'div[role="button"] i[style*="OtB1j6po0Jf.png"]'
      ];

      for (const selector of closeButtonSelectors) {
        console.log(`Trying close button selector: ${selector}`);
        try {
          const closeButton = await page.waitForSelector(selector, { timeout: 1000 });
          if (closeButton) {
            console.log(`Found close button with selector: ${selector}`);
            await closeButton.click();
            console.log('Clicked close button');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for dialog to disappear
            break;
          }
        } catch (selectorError) {
          console.log(`Close button selector ${selector} not found`);
        }
      }
    } catch (e) {
      console.log('Could not handle login dialog:', e);
    }

    // Get target date in French format
    const today = targetDate.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

    // Get all posts
    const posts = await page.$$('div[role="article"]');
    let menuData: MenuData = { text: null, imageUrl: null };

    // Look for today's menu in recent posts
    for (const post of posts) {
      // Get post date and text for debugging
      const postContent = await post.evaluate((el) => {
        const fullText = el.textContent || '';
        
        // First try to find time indicators in the full text
        const timeMatch = fullText.match(/(\d+)\s*[jh]\b/);
        if (timeMatch) {
          const number = parseInt(timeMatch[1], 10);
          const unit = timeMatch[0].endsWith('h') ? 'heures' : 'jours';
          return {
            dateText: `${number} ${unit}`,
            fullText: fullText,
            timeAgo: {
              value: number,
              unit: unit
            }
          };
        }

        // If no time indicators, try different selectors for absolute dates
        const dateSelectors = [
          'a[href*="/posts/"] > span', // Main timestamp link
          'a[href*="/posts/"] span[id]', // Timestamp span
          'a[role="link"] span[id]', // Generic timestamp
          'span > span > span > a[role="link"]', // Nested timestamp
          'span[id] > a[role="link"]', // Another timestamp format
          'div[role="article"] span:not([id])', // Generic spans that might contain date
          'a[role="link"]:not([href*="/posts/"]) span', // Other timestamp formats
        ];

        for (const selector of dateSelectors) {
          const elements = el.querySelectorAll(selector);
          for (const element of elements) {
            const text = element.textContent || '';
            // Look for time patterns
            if (text.match(/(\d+)\s*[jh]\b/) || 
                text.match(/\d+\/\d+\/\d+/) || 
                text.match(/\d+ [a-zéû]+ \d+/i)) {
              return {
                dateText: text,
                fullText: fullText
              };
            }
          }
        }
        
        return { dateText: '', fullText: fullText };
      });

      console.log('Post content:', {
        dateText: postContent.dateText,
        previewText: postContent.fullText.substring(0, 100) + '...'
      });

      let postDate: Date | null = null;

      // Parse the post date
      if (postContent.dateText) {
        const dateText = postContent.dateText.trim();
        
        if (postContent.timeAgo) {
          // Handle relative time formats (X jours, X heures) using current date as reference
          postDate = new Date(); // Use current date as reference for relative dates
          if (postContent.timeAgo.unit === 'jours') {
            postDate.setDate(postDate.getDate() - postContent.timeAgo.value);
          } else if (postContent.timeAgo.unit === 'heures') {
            postDate.setHours(postDate.getHours() - postContent.timeAgo.value);
          }
        } else if (dateText.toLowerCase().includes('hier')) {
          // Post from yesterday
          postDate = new Date(targetDate);
          postDate.setDate(postDate.getDate() - 1);
        } else if (dateText.match(/\d+\/\d+\/\d+/)) {
          // Format DD/MM/YYYY ou DD/MM/YY
          const [day, month, year] = dateText.split('/').map((n: string) => parseInt(n, 10));
          const fullYear = year < 100 ? 2000 + year : year;
          postDate = new Date(fullYear, month - 1, day);
        } else if (dateText.match(/\d+ [a-zéû]+ \d+/i)) {
          // Format comme "31 octobre 2025" ou "31 oct. 2025"
          const parts = dateText.split(' ');
          const day = parseInt(parts[0], 10);
          const month = [
            'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
            'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
          ].findIndex(m => parts[1].toLowerCase().startsWith(m.substring(0, 3)));
          const year = parseInt(parts[2], 10);
          if (month !== -1) {
            postDate = new Date(year, month, day);
          }
        } else {
          console.log('Unknown date format:', dateText);
        }

        // Log the parsed date and relative time info for debugging
        if (postDate) {
          console.log('Found post from:', postDate.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }), postContent.timeAgo ? `(${postContent.timeAgo.value} ${postContent.timeAgo.unit} ago)` : '');
        }
      }

      // Skip posts that aren't from target date
      if (!postDate || postDate.toDateString() !== targetDate.toDateString()) {
        console.log(`Skipping post from ${postDate?.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) || 'unknown date'}`);
        continue;
      }

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
            imageUrl: imageUrl,
            postDate: postDate
          };
          break;
        }
      }
    }

    await waitIfVisible(browser, argv.visible);
    await browser.close();
    return menuData;

  } catch (error) {
    console.error('Error fetching menu:', error);
    return null;
  }
}

async function downloadImage(url: string): Promise<string> {
  const browser = await puppeteer.launch({ headless: !argv.visible });
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

async function saveLastPost(imageUrl: string, date: Date = new Date()): Promise<void> {
  const lastPost: LastPost = {
    date: date.toISOString().split('T')[0],
    imageUrl: imageUrl
  };
  await fs.writeFile(LAST_POST_FILE, JSON.stringify(lastPost, null, 2));
}

async function checkMenu(force = false, simulatedDate?: Date) {
  const now = simulatedDate || new Date();
  const currentHour = now.getHours();
  
  if (!force && (currentHour < 9 || currentHour >= 12)) {
    console.log('Outside of checking hours (9h-12h), skipping check');
    return;
  }

  // Check if we already posted for the target date
  if (!force && await hasPostedToday(now)) {
    console.log('Menu has already been posted for this date, skipping');
    return;
  }

  console.log(`Checking menu for date: ${now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}${force ? ' (forced check)' : ''}...`);
  const menuData = await getTodayMenu(now);
  
  if (menuData && menuData.imageUrl) {
    if (menuData.postDate && menuData.postDate.toDateString() === now.toDateString()) {
      console.log('Menu found with image:', menuData.imageUrl);
      await notifySlack(menuData);
      // Save the fact that we posted with the target date
      await saveLastPost(menuData.imageUrl, now);
    } else {
      const postDate = menuData.postDate ? menuData.postDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'date inconnue';
      console.log(`Menu trouvé mais il date du ${postDate}, on ne le poste pas`);
    }
  } else {
    console.log('No menu or image found for today');
  }
}

// Check if running with command line arguments
if (argv.force || argv.date) {
  // Run once with provided arguments
  checkMenu(argv.force, argv.date as Date);
} else {
  // Schedule the task to run every hour from 9h to 12h
  cron.schedule('0 9-12 * * *', () => checkMenu());

  // Initial check when starting the script
  const currentHour = new Date().getHours();
  if (currentHour >= 9 && currentHour < 12) {
    checkMenu();
  }

  console.log('Menu scraper started. Waiting for scheduled checks (every hour from 9h to 12h)...');
}
