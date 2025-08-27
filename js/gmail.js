/* =================================================================
   AO3 to Kindle - Gmail API Integration
   Handle sending emails via Gmail API
   ================================================================= */

class GmailManager {
  constructor() {
    this.isInitialized = false;
    this.gapi = null;
  }

  /* =================================================================
     Initialization
     ================================================================= */

  /**
   * Initialize Gmail API client
   */
  async initGmailClient() {
    try {
      console.log('Initializing Gmail client...');
      
      if (typeof gapi === 'undefined') {
        throw new Error('Google API library not loaded');
      }
      
      this.gapi = gapi;
      
      // Gmail API should already be loaded via auth.js
      // Just verify we can access it
      if (!this.gapi.client.gmail) {
        console.log('Gmail API not yet loaded, loading...');
        await this.gapi.client.load('gmail', 'v1');
      }
      
      this.isInitialized = true;
      console.log('Gmail client initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize Gmail client:', error);
      throw error;
    }
  }

  /* =================================================================
     Email Composition & Sending
     ================================================================= */

  /**
   * Create MIME message with attachment
   */
  createMimeMessage(to, subject, body, attachment) {
    const boundary = 'boundary_' + Math.random().toString(36).substr(2, 9);
    
    let message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      body,
      ''
    ];

    if (attachment) {
      message = message.concat([
        `--${boundary}`,
        `Content-Type: ${attachment.mimeType}; name="${attachment.name}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${attachment.name}"`,
        '',
        attachment.data,
        ''
      ]);
    }

    message.push(`--${boundary}--`);
    
    return message.join('\r\n');
  }

  /**
   * Send email via Gmail API
   */
  async sendEmail(to, subject, body, attachment = null) {
    try {
      console.log('Preparing to send email to:', to);
      
      if (!this.isInitialized) {
        await this.initGmailClient();
      }

      if (!window.authManager || !window.authManager.isAuthenticated()) {
        throw new Error('User not authenticated');
      }

      // Get access token
      const accessToken = await window.authManager.getAccessToken();
      console.log('Using access token for Gmail API');
      
      // Set the access token for gapi client
      this.gapi.client.setToken({ access_token: accessToken });
      
      // Create MIME message
      const mimeMessage = this.createMimeMessage(to, subject, body, attachment);
      
      // Base64 encode the message
      const encodedMessage = btoa(mimeMessage).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      
      console.log('Sending email via Gmail API...');
      
      // Send the email
      const response = await this.gapi.client.gmail.users.messages.send({
        userId: 'me',
        resource: {
          raw: encodedMessage
        }
      });

      if (response.status === 200) {
        console.log('Email sent successfully:', response.result);
        return {
          success: true,
          messageId: response.result.id,
          threadId: response.result.threadId
        };
      } else {
        throw new Error(`Gmail API returned status: ${response.status}`);
      }
      
    } catch (error) {
      console.error('Failed to send email:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  /**
   * Send AO3 story to Kindle
   */
  async sendToKindle(kindleEmail, storyTitle, storyAuthor, fileData, fileName, fileType = 'mobi') {
    try {
      // Determine MIME type
      const mimeTypes = {
        'mobi': 'application/x-mobipocket-ebook',
        'epub': 'application/epub+zip',
        'azw3': 'application/vnd.amazon.ebook'
      };
      
      const mimeType = mimeTypes[fileType.toLowerCase()] || 'application/octet-stream';
      
      // Create email subject (with "Convert" for Kindle processing)
      const subject = `Convert: ${storyTitle}`;
      
      // Create email body
      const body = `
        <html>
        <body>
          <h2>${storyTitle}</h2>
          <p><strong>Author:</strong> ${storyAuthor}</p>
          <p>This story has been sent to your Kindle from AO3 to Kindle service.</p>
          <hr>
          <p><small>
            Sent via <a href="https://rheath.github.io/ao3-to-kindle">AO3 to Kindle</a> - 
            A free service to send fanfiction to your Kindle device.
          </small></p>
        </body>
        </html>
      `;
      
      // Create attachment object
      const attachment = {
        name: fileName,
        mimeType: mimeType,
        data: fileData // Should be base64 encoded
      };
      
      console.log('Sending story to Kindle:', { 
        title: storyTitle, 
        author: storyAuthor, 
        fileName: fileName,
        fileType: fileType
      });
      
      // Send the email
      return await this.sendEmail(kindleEmail, subject, body, attachment);
      
    } catch (error) {
      console.error('Failed to send to Kindle:', error);
      throw error;
    }
  }

  /* =================================================================
     Utilities
     ================================================================= */

  /**
   * Validate email address format
   */
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate Kindle email address
   */
  validateKindleEmail(email) {
    if (!this.validateEmail(email)) {
      return false;
    }
    
    // Check if it's a Kindle email domain
    const kindleDomains = ['@kindle.com', '@free.kindle.com'];
    return kindleDomains.some(domain => email.toLowerCase().endsWith(domain));
  }
}

/* =================================================================
   Global Gmail Manager Instance
   ================================================================= */

// Create global gmail manager instance
window.gmailManager = new GmailManager();

/* =================================================================
   Export for ES6 modules (if needed)
   ================================================================= */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GmailManager;
}