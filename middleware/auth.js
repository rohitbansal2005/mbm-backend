const jwt = require('jsonwebtoken');
const User = require('../models/User');
const mongoose = require('mongoose');

const auth = async (req, res, next) => {
    try {
        // Check if JWT_SECRET is configured
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET environment variable is not configured');
            return res.status(500).json({ 
                message: 'Server configuration error',
                error: 'JWT secret not configured'
            });
        }

        console.log('=== Auth Middleware ===');
        console.log('Request headers:', req.headers);
        
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            console.log('No Authorization header found');
            return res.status(401).json({ message: 'No authentication token, access denied' });
        }

        // Check if header starts with "Bearer "
        if (!authHeader.startsWith('Bearer ')) {
            console.log('Invalid Authorization header format');
            return res.status(401).json({ message: 'Invalid token format. Use "Bearer <token>"' });
        }

        // Strip "Bearer " from the header
        const token = authHeader.substring(7);
        
        // Check if token is empty
        if (!token || token.trim() === '') {
            console.log('Empty token after stripping Bearer');
            return res.status(401).json({ message: 'Empty authentication token' });
        }

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('Token decoded successfully');
        } catch (jwtError) {
            console.error('JWT verification failed:', jwtError.message);
            
            if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({ 
                    message: 'Invalid token format',
                    error: 'Token verification failed'
                });
            } else if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    message: 'Token has expired',
                    error: 'Token expired'
                });
            } else {
                return res.status(401).json({ 
                    message: 'Token verification failed',
                    error: jwtError.message
                });
            }
        }
        
        // Check for userId or _id in the token (support both payload styles)
        const userId = decoded.userId || decoded._id;
        console.log('Decoded userId:', userId, '|', typeof userId, '|', userId && userId.length);
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            console.error('Invalid userId:', userId, '|', typeof userId, '|', userId && userId.length);
            return res.status(401).json({
                message: 'Invalid user ID',
                error: 'Token verification failed'
            });
        }

        // Get user from database
        const user = await User.findById(userId);
        if (!user) {
            console.error('User not found:', userId);
            return res.status(401).json({ 
                message: 'User not found',
                error: 'Token verification failed'
            });
        }

        // Check if user is banned
        if (user.isBanned) {
            console.error('Banned user trying to access:', userId);
            return res.status(403).json({ 
                message: 'Account is banned',
                error: 'Access denied'
            });
        }

        // Set user info in request
        req.user = {
            _id: user._id,
            userId: user._id,
            username: user.username,
            role: user.role || 'user'
        };
        console.log('Auth successful, user info set:', req.user);
        next();
    } catch (error) {
        console.error('Auth middleware error:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            message: 'Server error in auth middleware',
            error: error.message
        });
    }
};

module.exports = auth; 