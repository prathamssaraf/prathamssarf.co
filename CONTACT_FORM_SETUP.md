# Contact Form Setup Instructions

Your contact form has been updated to work with form submission services. Here are two options to get it working:

## Option 1: Web3Forms (Recommended - Easier Setup)

### ✅ Step 1: Get Your Access Key
1. Go to [https://web3forms.com](https://web3forms.com)
2. Enter your email: `prathamssaraf@gmail.com`  
3. Click "Create Access Key"
4. Copy the access key they provide

### ✅ Step 2: Update Your Code
1. Open `index.html`
2. Find line 705: `<input type="hidden" name="access_key" value="YOUR_ACCESS_KEY_HERE">`
3. Replace `YOUR_ACCESS_KEY_HERE` with your actual access key

### ✅ Step 3: Test!
Your form will now send emails directly to `prathamssaraf@gmail.com`!

**Benefits of Web3Forms:**
- ✅ No account creation needed
- ✅ 1000 free submissions per month
- ✅ No captcha required
- ✅ Works immediately after setup

---

## Option 2: Formspree (More Features)

### ✅ Step 1: Create Account
1. Go to [https://formspree.io](https://formspree.io)
2. Sign up with your email
3. Verify your email address

### ✅ Step 2: Create Form
1. Click "New Form" in your dashboard
2. Name it "Portfolio Contact Form"
3. Copy your form endpoint (looks like `https://formspree.io/f/abc123xyz`)

### ✅ Step 3: Update Your Code
1. Open `index.html`
2. Find line 703: `<form id="contact-form" action="https://api.web3forms.com/submit" method="POST">`
3. Replace with: `<form id="contact-form" action="YOUR_FORMSPREE_ENDPOINT" method="POST">`
4. Remove the Web3Forms hidden inputs (lines 705-707)

**Benefits of Formspree:**
- ✅ 50 free submissions per month
- ✅ Spam filtering
- ✅ File uploads support
- ✅ Form analytics dashboard

---

## What's Already Implemented

✅ **Contact Form Features:**
- Form validation (all fields required)
- Loading states ("Sending..." button)
- Success/error messages with styling
- Form reset after successful submission
- Smooth scrolling to contact form
- Fallback to direct email link if service fails

## Testing Your Form

1. Fill out the contact form on your website
2. Click "Send Message"
3. You should see a green success message
4. Check your Gmail inbox for the message

## Troubleshooting

**"Access Key not found" error:**
- Make sure you replaced `YOUR_ACCESS_KEY_HERE` with your actual Web3Forms access key

**Form not submitting:**
- Check browser console for JavaScript errors
- Ensure your internet connection is working
- Try the direct email fallback link

**Not receiving emails:**
- Check your spam folder
- Verify you entered the correct email when getting the access key
- For Formspree, ensure you've verified your account

## Free Tier Limits

**Web3Forms Free:**
- 1000 submissions per month
- Basic spam protection
- Email notifications

**Formspree Free:**
- 50 submissions per month
- Advanced spam filtering
- Dashboard analytics

Both options are more than sufficient for a personal portfolio website!