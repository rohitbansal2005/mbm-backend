const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Ultimate Security Middleware
const ultimateSecurity = {
    // 1. SUPER STRICT RATE LIMITING
    superRateLimit: rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 3, // Max 3 requests per minute
        message: {
            error: 'Too many requests. Please try again later.',
            code: 'RATE_LIMIT_EXCEEDED'
        },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: false,
        keyGenerator: (req) => {
            return req.ip + req.headers['user-agent'] + req.headers['x-forwarded-for'];
        }
    }),

    // 2. ULTRA STRICT RATE LIMITING FOR AUTH
    authRateLimit: rateLimit({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 2, // Max 2 login attempts per 5 minutes
        message: {
            error: 'Too many login attempts. Please try again in 5 minutes.',
            code: 'AUTH_RATE_LIMIT_EXCEEDED'
        },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: false,
        keyGenerator: (req) => {
            return req.ip + req.headers['user-agent'];
        }
    }),

    // 3. POST CREATION RATE LIMIT
    postRateLimit: rateLimit({
        windowMs: 10 * 60 * 1000, // 10 minutes
        max: 1, // Max 1 post per 10 minutes
        message: {
            error: 'Post creation rate limit exceeded. Please wait 10 minutes.',
            code: 'POST_RATE_LIMIT_EXCEEDED'
        },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: false,
        keyGenerator: (req) => {
            return req.user ? req.user._id.toString() : req.ip;
        }
    }),

    // 4. MESSAGE RATE LIMIT
    messageRateLimit: rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 5, // Max 5 messages per minute
        message: {
            error: 'Message rate limit exceeded. Please slow down.',
            code: 'MESSAGE_RATE_LIMIT_EXCEEDED'
        },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: false,
        keyGenerator: (req) => {
            return req.user ? req.user._id.toString() : req.ip;
        }
    }),

    // 5. HELMET SECURITY HEADERS
    helmetConfig: helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https:"],
                scriptSrc: ["'self'"],
                connectSrc: ["'self'"],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: []
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
    }),

    // 6. CORS CONFIGURATION
    corsConfig: cors({
        origin: process.env.FRONTEND_URL || 'https://mbmconnect.vercel.app',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        exposedHeaders: ['X-Total-Count'],
        maxAge: 86400 // 24 hours
    }),

    // 7. BOT DETECTION
    botDetection: (req, res, next) => {
        const userAgent = req.headers['user-agent'] || '';
        const suspiciousPatterns = [
            /bot/i, /crawler/i, /spider/i, /scraper/i, /curl/i, /wget/i,
            /python/i, /java/i, /perl/i, /ruby/i, /php/i, /go/i,
            /headless/i, /phantom/i, /selenium/i, /puppeteer/i,
            /automation/i, /script/i, /scraper/i
        ];

        const isBot = suspiciousPatterns.some(pattern => pattern.test(userAgent));
        
        if (isBot) {
            return res.status(403).json({
                error: 'Access denied. Bots are not allowed.',
                code: 'BOT_DETECTED'
            });
        }

        // Check for suspicious headers
        const suspiciousHeaders = [
            'x-forwarded-for', 'x-real-ip', 'x-client-ip',
            'cf-connecting-ip', 'x-forwarded', 'forwarded-for'
        ];

        const hasSuspiciousHeaders = suspiciousHeaders.some(header => 
            req.headers[header] && req.headers[header].includes(',')
        );

        if (hasSuspiciousHeaders) {
            return res.status(403).json({
                error: 'Access denied. Suspicious request detected.',
                code: 'SUSPICIOUS_HEADERS'
            });
        }

        next();
    },

    // 8. REQUEST SIZE LIMITING
    requestSizeLimit: (req, res, next) => {
        const contentLength = parseInt(req.headers['content-length'] || '0');
        
        if (contentLength > 10 * 1024 * 1024) { // 10MB limit
            return res.status(413).json({
                error: 'Request too large. Maximum size is 10MB.',
                code: 'REQUEST_TOO_LARGE'
            });
        }

        next();
    },

    // 9. ENHANCED AUTH MIDDLEWARE
    enhancedAuth: async (req, res, next) => {
        try {
            const token = req.header('Authorization')?.replace('Bearer ', '');
            
            if (!token) {
                return res.status(401).json({
                    error: 'Access denied. No token provided.',
                    code: 'NO_TOKEN'
                });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded._id).select('-password');

            if (!user) {
                return res.status(401).json({
                    error: 'Access denied. Invalid token.',
                    code: 'INVALID_TOKEN'
                });
            }

            // Check if user is banned
            if (user.isBanned) {
                return res.status(403).json({
                    error: 'Access denied. Account is banned.',
                    code: 'ACCOUNT_BANNED'
                });
            }

            // Check for suspicious activity
            if (user.suspiciousActivity) {
                return res.status(403).json({
                    error: 'Access denied. Suspicious activity detected.',
                    code: 'SUSPICIOUS_ACTIVITY'
                });
            }

            req.user = user;
            next();
        } catch (error) {
            return res.status(401).json({
                error: 'Access denied. Invalid token.',
                code: 'TOKEN_ERROR'
            });
        }
    },

    // 10. INPUT VALIDATION
    inputValidation: (req, res, next) => {
        const body = req.body;
        
        // Check for suspicious patterns in all fields
        const suspiciousPatterns = [
            /<script/i, /javascript:/i, /on\w+\s*=/i, /eval\(/i, /document\./i,
            /window\./i, /alert\(/i, /confirm\(/i, /prompt\(/i, /console\./i,
            /import\s+/, /require\s*\(/, /process\./, /global\./, /__proto__/,
            /constructor/, /prototype/, /toString/, /valueOf/, /hasOwnProperty/
        ];

        const checkSuspicious = (obj) => {
            for (let key in obj) {
                if (typeof obj[key] === 'string') {
                    const value = obj[key];
                    if (suspiciousPatterns.some(pattern => pattern.test(value))) {
                        return true;
                    }
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    if (checkSuspicious(obj[key])) {
                        return true;
                    }
                }
            }
            return false;
        };

        if (checkSuspicious(body)) {
            return res.status(400).json({
                error: 'Suspicious input detected. Request blocked.',
                code: 'SUSPICIOUS_INPUT'
            });
        }

        next();
    },

    // 11. GEO-BLOCKING (Optional - for extra security)
    geoBlocking: (req, res, next) => {
        // You can implement country-based blocking here
        // For now, we'll allow all countries
        next();
    },

    // 12. REQUEST LOGGING
    requestLogger: (req, res, next) => {
        const timestamp = new Date().toISOString();
        const ip = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const method = req.method;
        const url = req.url;

        console.log(`[${timestamp}] ${ip} - ${method} ${url} - ${userAgent}`);

        // Log suspicious requests
        if (req.headers['user-agent'] && req.headers['user-agent'].includes('bot')) {
            console.warn(`[SUSPICIOUS] Bot detected: ${ip} - ${userAgent}`);
        }

        next();
    }
};

module.exports = ultimateSecurity; 