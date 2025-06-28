const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        console.log('=== Auth Middleware ===');
        console.log('Request headers:', req.headers);
        
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            console.log('No Authorization header found');
            return res.status(401).json({ message: 'No authentication token, access denied' });
        }

        // Strip "Bearer " from the header
        const token = authHeader.split(' ')[1];
        
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Token decoded:', decoded ? '{...user data...}' : 'null');
        
        // Check for userId in the token (from login/register routes)
        const userId = decoded.userId || decoded._id;
        if (!userId) {
            console.error('Token missing userId:', decoded);
            return res.status(401).json({ 
                message: 'Invalid token format: missing userId',
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