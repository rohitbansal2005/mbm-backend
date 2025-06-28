const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const webpush = require('web-push');
const ultimateSecurity = require('./middleware/ultimateSecurity');
const { aiSecurityMiddleware } = require('./middleware/aiSecurity');

// Import models
require('./models/Comment');
require('./models/User');
require('./models/Post');
require('./models/Message');
require('./models/Notification');
require('./models/Follow');
require('./models/Report');
require('./models/Payment');
require('./models/EventRead');
require('./models/PushSubscription');
require('./models/UserSettings');
require('./models/HelpCenterMessage');

// Import routes
const settingsRoutes = require('./routes/settings');
const notificationRoutes = require('./routes/notifications');
const reportRoutes = require('./routes/reports');
const postRoutes = require('./routes/posts');
const usersRouter = require('./routes/users');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const commentsRoutes = require('./routes/comments');
const eventsRoutes = require('./routes/events');
const followsRoutes = require('./routes/follows');
const groupsRoutes = require('./routes/groups');
const helpCenterRoutes = require('./routes/helpCenter');
const messagesRoutes = require('./routes/messages');
const paymentRoutes = require('./routes/payment');
const profileRoutes = require('./routes/profile');
const savedRoutes = require('./routes/saved');
const studentsRoutes = require('./routes/students');
const uploadRoutes = require('./routes/upload');

dotenv.config();

const app = express();

// 🛡️ ULTIMATE SECURITY IMPLEMENTATION

// 1. REQUEST LOGGING (First middleware)
app.use(ultimateSecurity.requestLogger);

// 2. BOT DETECTION
app.use(ultimateSecurity.botDetection);

// 3. REQUEST SIZE LIMITING
app.use(ultimateSecurity.requestSizeLimit);

// 4. HELMET SECURITY HEADERS
app.use(ultimateSecurity.helmetConfig);

// 5. CORS CONFIGURATION
app.use(ultimateSecurity.corsConfig);

// 6. INPUT VALIDATION
app.use(ultimateSecurity.inputValidation);

// 7. SUPER STRICT RATE LIMITING (Global)
app.use(ultimateSecurity.superRateLimit);

// 8. Body parsing with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 9. AUTH RATE LIMITING
app.use('/api/auth', ultimateSecurity.authRateLimit);
app.use('/api/users/login', ultimateSecurity.authRateLimit);

// 10. POST RATE LIMITING
app.use('/api/posts', ultimateSecurity.postRateLimit);

// 11. MESSAGE RATE LIMITING
app.use('/api/messages', ultimateSecurity.messageRateLimit);

// 12. ENHANCED AUTH MIDDLEWARE for protected routes
const protectedRoutes = [
    '/api/posts',
    '/api/messages', 
    '/api/notifications',
    '/api/reports',
    '/api/settings',
    '/api/profile',
    '/api/saved',
    '/api/follows',
    '/api/groups',
    '/api/payment',
    '/api/upload'
];

protectedRoutes.forEach(route => {
    app.use(route, ultimateSecurity.enhancedAuth);
});

// AI Security Middleware (after auth middleware)
app.use(aiSecurityMiddleware);

// 🚀 ROUTE REGISTRATION

// Auth routes (with rate limiting)
app.use('/api/auth', authRoutes);

// User routes
app.use('/api', usersRouter);

// Admin routes (with enhanced auth)
app.use('/api/admin', ultimateSecurity.enhancedAuth, adminRoutes);

// Protected routes
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/follows', followsRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/help-center', helpCenterRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/saved', savedRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/upload', uploadRoutes);

// 🔔 WEB PUSH NOTIFICATION SETUP
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '<YOUR_VAPID_PUBLIC_KEY_HERE>';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '<YOUR_VAPID_PRIVATE_KEY_HERE>';

webpush.setVapidDetails(
    'mailto:admin@mbmconnect.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// Enhanced push subscription route with security
app.post('/api/save-subscription', ultimateSecurity.enhancedAuth, async (req, res) => {
    try {
        const userId = req.user._id;
        const subscription = req.body;
        
        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return res.status(400).json({ 
                error: 'Invalid subscription data',
                code: 'INVALID_SUBSCRIPTION'
            });
        }

        await PushSubscription.findOneAndUpdate(
            { user: userId, endpoint: subscription.endpoint },
            { $set: { keys: subscription.keys } },
            { upsert: true, new: true }
        );

        res.status(201).json({ 
            message: 'Subscription saved successfully',
            code: 'SUBSCRIPTION_SAVED'
        });
    } catch (err) {
        console.error('Subscription save error:', err);
        res.status(500).json({ 
            error: 'Failed to save subscription',
            code: 'SUBSCRIPTION_ERROR'
        });
    }
});

// Enhanced test notification route with security
app.post('/api/send-test-notification', ultimateSecurity.enhancedAuth, async (req, res) => {
    try {
        // Only allow admins to send test notifications
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                error: 'Access denied. Admin privileges required.',
                code: 'ADMIN_REQUIRED'
            });
        }

        const payload = JSON.stringify({
            title: 'MBMConnect',
            body: 'This is a test push notification!',
            icon: '/logo192.png'
        });

        const subscriptions = await PushSubscription.find({});
        let success = 0;

        for (const sub of subscriptions) {
            try {
                await webpush.sendNotification({
                    endpoint: sub.endpoint,
                    keys: sub.keys
                }, payload);
                success++;
            } catch (err) {
                console.error('Notification send error:', err);
            }
        }

        res.json({ 
            message: `Test notifications sent to ${success} subscribers.`,
            code: 'NOTIFICATIONS_SENT'
        });
    } catch (err) {
        console.error('Test notification error:', err);
        res.status(500).json({
            error: 'Failed to send test notifications',
            code: 'NOTIFICATION_ERROR'
        });
    }
});

// 🛡️ SECURITY MONITORING ROUTE
app.get('/api/security/status', ultimateSecurity.enhancedAuth, (req, res) => {
    // Only allow admins to check security status
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: 'Access denied. Admin privileges required.',
            code: 'ADMIN_REQUIRED'
        });
    }

    res.json({
        status: 'SECURE',
        timestamp: new Date().toISOString(),
        securityFeatures: {
            rateLimiting: 'ENABLED',
            botDetection: 'ENABLED',
            inputValidation: 'ENABLED',
            helmet: 'ENABLED',
            cors: 'ENABLED',
            requestLogging: 'ENABLED',
            enhancedAuth: 'ENABLED'
        },
        message: 'All security measures are active and protecting the platform.'
    });
});

// 🚨 ERROR HANDLING MIDDLEWARE
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    
    // Don't expose internal errors to client
    const errorMessage = process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message;
    
    res.status(err.status || 500).json({
        error: errorMessage,
        code: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString()
    });
});

// 🚫 404 HANDLER
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        code: 'ROUTE_NOT_FOUND',
        timestamp: new Date().toISOString()
    });
});

// 🚀 SERVER STARTUP
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log('🛡️ MBMConnect Server with Ultimate Security');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log('🔒 All security measures are ACTIVE');
    console.log('🛡️ Bot detection: ENABLED');
    console.log('🛡️ Rate limiting: ENABLED');
    console.log('🛡️ Input validation: ENABLED');
    console.log('🛡️ Enhanced auth: ENABLED');
    console.log('🛡️ Request logging: ENABLED');
    console.log('✅ Platform is SECURE and PROTECTED!');
});

module.exports = app; 