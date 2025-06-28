const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const { verifyRecaptcha } = require('../middleware/recaptcha');

// Store OTPs temporarily (in production, use Redis or similar)
const otpStore = new Map();

// Configure nodemailer with better error handling
let transporter;
try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        throw new Error('Email configuration is missing. Please set EMAIL_USER and EMAIL_PASS in .env file');
    }

    console.log('Configuring email with:', {
        user: process.env.EMAIL_USER,
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        // Don't log the actual password
        hasPassword: !!process.env.EMAIL_PASS
    });

    transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        },
        tls: {
            rejectUnauthorized: false // Only for development
        }
    });

    // Verify transporter configuration
    transporter.verify(function(error, success) {
        if (error) {
            console.error('Email configuration error:', error);
        } else {
            console.log('Email server is ready to send messages');
        }
    });
} catch (error) {
    console.error('Failed to configure email:', error);
}

// Generate OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString().padStart(6, '0');
};

// Send OTP for registration
router.post('/send-otp', verifyRecaptcha, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP with expiration (5 minutes)
    otpStore.set(email, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    // Send email with OTP
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'MBMConnect Email Verification',
        html: `
          <h1>Email Verification</h1>
          <p>Your verification code is: <strong>${otp}</strong></p>
          <p>This code will expire in 5 minutes.</p>
        `
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Still log OTP for development
      console.log(`OTP for ${email}: ${otp}`);
    }

    res.json({ 
      success: true,
      message: 'OTP sent successfully' 
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// Verify OTP
router.post('/verify-otp', verifyRecaptcha, async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const storedOTP = otpStore.get(email);
    
    if (!storedOTP) {
      return res.status(400).json({ message: 'OTP not found or expired' });
    }

    if (Date.now() > storedOTP.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ message: 'OTP has expired' });
    }

    if (storedOTP.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Mark email as verified
    otpStore.delete(email);
    
    res.json({ message: 'OTP verified successfully' });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ message: 'Failed to verify OTP' });
  }
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;
        
        const otp = generateOTP();
        otpStore.set(email, {
            otp,
            timestamp: Date.now()
        });

        // Send email
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'MBMConnect Email Verification',
            html: `
                <h1>Email Verification</h1>
                <p>Your new verification code is: <strong>${otp}</strong></p>
                <p>This code will expire in 10 minutes.</p>
            `
        });

        res.json({
            success: true,
            message: 'OTP resent successfully'
        });
    } catch (error) {
        console.error('Resend OTP error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resend OTP'
        });
    }
});

// Forgot Password - Send OTP
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        console.log('Forgot password request received for email:', email);
        
        // Check if email exists
        const user = await User.findOne({ email });
        console.log('User found:', user ? 'Yes' : 'No');
        
        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'No account found with this email'
            });
        }

        const otp = generateOTP();
        console.log('Generated OTP for password reset');
        
        otpStore.set(email, {
            otp,
            timestamp: Date.now(),
            type: 'reset'
        });

        // Send email
        console.log('Attempting to send email...');
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'MBMConnect Password Reset',
            html: `
                <h1>Password Reset</h1>
                <p>Your verification code is: <strong>${otp}</strong></p>
                <p>This code will expire in 10 minutes.</p>
            `
        });
        console.log('Email sent successfully');

        res.json({
            success: true,
            message: 'OTP sent successfully'
        });
    } catch (error) {
        console.error('Forgot password error details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send OTP'
        });
    }
});

// Verify Reset OTP
router.post('/verify-reset-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const storedData = otpStore.get(email);

        if (!storedData || storedData.type !== 'reset') {
            return res.status(400).json({
                success: false,
                message: 'OTP expired or invalid'
            });
        }

        // Check if OTP is expired (10 minutes)
        if (Date.now() - storedData.timestamp > 10 * 60 * 1000) {
            otpStore.delete(email);
            return res.status(400).json({
                success: false,
                message: 'OTP expired'
            });
        }

        if (storedData.otp !== otp) {
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP'
            });
        }

        res.json({
            success: true,
            message: 'OTP verified successfully'
        });
    } catch (error) {
        console.error('Verify reset OTP error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify OTP'
        });
    }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const storedData = otpStore.get(email);

        if (!storedData || storedData.type !== 'reset') {
            return res.status(400).json({
                success: false,
                message: 'OTP expired or invalid'
            });
        }

        // Check if OTP is expired (10 minutes)
        if (Date.now() - storedData.timestamp > 10 * 60 * 1000) {
            otpStore.delete(email);
            return res.status(400).json({
                success: false,
                message: 'OTP expired'
            });
        }

        if (storedData.otp !== otp) {
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP'
            });
        }

        // Update password
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'User not found'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        // Clear OTP
        otpStore.delete(email);

        res.json({
            success: true,
            message: 'Password reset successfully'
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset password'
        });
    }
});

// Resend Reset OTP
router.post('/resend-reset-otp', async (req, res) => {
    try {
        const { email } = req.body;
        
        const otp = generateOTP();
        otpStore.set(email, {
            otp,
            timestamp: Date.now(),
            type: 'reset'
        });

        // Send email
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'MBMConnect Password Reset',
            html: `
                <h1>Password Reset</h1>
                <p>Your new verification code is: <strong>${otp}</strong></p>
                <p>This code will expire in 10 minutes.</p>
            `
        });

        res.json({
            success: true,
            message: 'OTP resent successfully'
        });
    } catch (error) {
        console.error('Resend reset OTP error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resend OTP'
        });
    }
});

// Admin Login
router.post('/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check if user is admin
        if (user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin privileges required.'
            });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { _id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: 'Admin login successful',
            token,
            user: {
                _id: user._id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Login route
router.post('/login', verifyRecaptcha, async (req, res) => {
  try {
    const { email, password, recaptchaToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if user is banned
    if (user.isBanned) {
      return res.status(403).json({ message: 'Account is banned' });
    }

    // Check if account is locked
    if (user.isLocked()) {
      return res.status(423).json({ message: 'Account is temporarily locked due to too many failed login attempts' });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      // Increment failed login attempts
      await user.incrementLoginAttempts();
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Reset failed login attempts on successful login
    if (user.failedLoginAttempts > 0) {
      user.failedLoginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }

    // Update last seen
    user.lastSeen = new Date();
    user.isOnline = true;
    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName || user.username,
        role: user.role,
        isVerified: user.isVerified,
        isPremium: user.isPremium,
        badgeType: user.badgeType,
        profilePicture: user.profilePicture,
        avatar: user.avatar
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed' });
  }
});

// Test email configuration
router.get('/test-email', async (req, res) => {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            return res.status(500).json({
                success: false,
                message: 'Email configuration is missing in .env file'
            });
        }

        console.log('Testing email configuration with:', {
            user: process.env.EMAIL_USER,
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT,
            hasPassword: !!process.env.EMAIL_PASS
        });

        if (!transporter) {
            return res.status(500).json({
                success: false,
                message: 'Email transporter not initialized'
            });
        }

        // Test email
        const testMailOptions = {
            from: `"MBMConnect" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER, // Send to self
            subject: 'MBMConnect Email Test',
            html: `
                <h1>Email Test</h1>
                <p>If you receive this email, your email configuration is working correctly.</p>
            `
        };

        await transporter.sendMail(testMailOptions);
        console.log('Test email sent successfully');

        res.json({
            success: true,
            message: 'Test email sent successfully'
        });
    } catch (error) {
        console.error('Test email error:', {
            message: error.message,
            code: error.code,
            command: error.command
        });
        res.status(500).json({
            success: false,
            message: `Email test failed: ${error.message}`
        });
    }
});

// Registration route with ultimate security
router.post('/register', verifyRecaptcha, async (req, res) => {
  try {
    const { username, email, password, fullName, phone, department, year, inviteCode, referralCode, recaptchaToken } = req.body;

    // Basic validation
    if (!username || !email || !password || !fullName) {
      return res.status(400).json({ message: 'Username, email, password, and full name are required' });
    }

    // Validate invite code
    if (inviteCode !== 'MBM2005') {
      return res.status(400).json({ message: 'Invalid invite code. Only college students can register.' });
    }

    // Strict input validation
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ message: 'Username must be 3-20 characters' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    if (fullName.length < 2 || fullName.length > 50) {
      return res.status(400).json({ message: 'Full name must be 2-50 characters' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate referral code if not provided
    const userReferralCode = referralCode || `REF${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

    // Create user (auto-approved)
    const user = new User({
      username,
      email,
      password: hashedPassword,
      fullName,
      phone: phone || '',
      department: department || 'General',
      year: year || '1st Year',
      inviteCode,
      referralCode: userReferralCode,
      isApproved: true, // Auto-approved
      isVerified: true, // Auto-verified for now
      registrationDate: new Date()
    });

    await user.save();

    // Generate JWT token for immediate login
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ 
      success: true,
      message: 'Registration successful!',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isVerified: user.isVerified,
        isPremium: user.isPremium,
        badgeType: user.badgeType,
        referralCode: user.referralCode
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Registration failed' });
  }
});

// At the end of the file, export router as default and transporter as named export
module.exports = router;
module.exports.transporter = transporter; 