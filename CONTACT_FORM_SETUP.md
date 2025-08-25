# Contact Form Setup Instructions

Your contact form has been updated to work with EmailJS, a service that allows you to send emails directly from your static website without a backend server.

## What's Been Implemented

✅ **Contact Form Updates:**
- Added form validation (all fields are now required)
- Added visual feedback for success/error messages
- Added loading state when sending messages
- Made "Contact Me" button scroll smoothly to the contact form
- Added EmailJS integration for sending emails

## Setup Required (EmailJS Configuration)

To make the contact form fully functional, you need to set up EmailJS:

### Step 1: Create EmailJS Account
1. Go to [https://www.emailjs.com/](https://www.emailjs.com/)
2. Sign up for a free account
3. Verify your email address

### Step 2: Create Email Service
1. In your EmailJS dashboard, go to "Email Services"
2. Click "Add New Service"
3. Choose your email provider (Gmail, Outlook, etc.)
4. Follow the setup instructions for your chosen provider
5. Note down your **Service ID**

### Step 3: Create Email Template
1. Go to "Email Templates" in your dashboard
2. Click "Create New Template"
3. Use this template structure:

**Template Variables:**
```
From: {{from_name}} <{{from_email}}>
To: {{to_name}}
Subject: Portfolio Contact: {{subject}}

Message:
{{message}}

---
This message was sent from your portfolio contact form.
```

4. Save the template and note down your **Template ID**

### Step 4: Get Your Public Key
1. Go to "Account" section in your EmailJS dashboard
2. Find your **Public Key** (starts with "user_" or is a random string)

### Step 5: Update Configuration
1. Open `js/main.js`
2. Replace the following placeholders:
   - `YOUR_PUBLIC_KEY` with your actual public key
   - `YOUR_SERVICE_ID` with your service ID
   - `YOUR_TEMPLATE_ID` with your template ID

**Example:**
```javascript
emailjs.init("user_abcd1234efgh5678"); // Your public key
emailjs.send('service_abc123', 'template_xyz789', templateParams) // Your service and template IDs
```

## Testing the Form

After completing the setup:
1. Open your website in a browser
2. Fill out the contact form
3. Click "Send Message"
4. You should see a success message and receive an email

## Features

- **Form Validation**: All fields are required before submission
- **Visual Feedback**: Success/error messages with appropriate styling
- **Loading State**: Button shows "Sending..." while processing
- **Email Fallback**: If EmailJS fails, users see your direct email address
- **Smooth Scrolling**: "Contact Me" button scrolls to the form
- **Form Reset**: Form clears after successful submission

## Troubleshooting

- **Form not sending**: Check your EmailJS credentials in `js/main.js`
- **No success/error message**: Check browser console for JavaScript errors
- **Emails not received**: Verify your EmailJS service and template configuration
- **Styling issues**: Check that Bootstrap CSS is loading properly

## Free Tier Limits

EmailJS free tier allows:
- 200 emails per month
- 2 email services
- 1 email template

This should be sufficient for a personal portfolio website.