// Vercel serverless function
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

// MongoDB connection (cached across function invocations)
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  cachedDb = mongoose.connection;
  console.log('✅ MongoDB connected');
  return cachedDb;
}

// Define Subscriber schema
const subscriberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  subscribedAt: {
    type: Date,
    default: Date.now
  }
});

// Create or retrieve the model
const Subscriber = mongoose.models.Subscriber || mongoose.model('Subscriber', subscriberSchema);

// Email transporter (reused)
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('Email credentials missing in environment variables');
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  return transporter;
}

// Send confirmation email
async function sendConfirmationEmail(name, email) {
  const mailOptions = {
    from: `"Newsletter" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Subscription Confirmed!',
    text: `Hi ${name},\n\nThank you for subscribing to our newsletter! You have been successfully registered.\n\nBest regards,\nThe Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
        <h2 style="color: #0070f3;">Subscription Confirmed ✅</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>Thank you for subscribing to our newsletter! You have been successfully registered.</p>
        <p>We'll keep you updated with the latest news and offers.</p>
        <hr style="border: none; border-top: 1px solid #eee;" />
        <p style="color: #888; font-size: 0.9em;">Best regards,<br>The Team</p>
      </div>
    `
  };

  const transporter = getTransporter();
  await transporter.sendMail(mailOptions);
  console.log(`📧 Confirmation email sent to ${email}`);
}

// Main handler
export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email } = req.body;

  // Basic validation
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const emailRegex = /^\S+@\S+\.\S+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    // Connect to MongoDB
    await connectToDatabase();

    // Check if email already exists
    const existing = await Subscriber.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'This email is already subscribed' });
    }

    // Create new subscriber
    const subscriber = new Subscriber({ name, email });
    await subscriber.save();
    console.log(`💾 New subscriber: ${email}`);

    // Send confirmation email
    await sendConfirmationEmail(name, email);

    res.status(201).json({
      message: 'Subscription successful! A confirmation email has been sent.'
    });
  } catch (error) {
    console.error('❌ Error in subscribe handler:', error);

    // Handle duplicate key error (just in case)
    if (error.code === 11000) {
      return res.status(409).json({ error: 'This email is already subscribed' });
    }

    res.status(500).json({
      error: 'Internal server error. Please try again later.'
    });
  }
}
