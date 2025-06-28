const axios = require('axios');

// reCAPTCHA Verification Middleware
const verifyRecaptcha = async (req, res, next) => {
    try {
        const { recaptchaToken } = req.body;
        
        if (!recaptchaToken) {
            return res.status(400).json({
                error: 'reCAPTCHA token is required',
                code: 'RECAPTCHA_TOKEN_MISSING'
            });
        }

        // Verify with Google reCAPTCHA API
        const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
        const secretKey = process.env.RECAPTCHA_SECRET_KEY;
        
        const response = await axios.post(verificationUrl, null, {
            params: {
                secret: secretKey,
                response: recaptchaToken,
                remoteip: req.ip
            }
        });

        const { success, score, action, challenge_ts, hostname, 'error-codes': errorCodes } = response.data;

        if (!success) {
            console.warn('reCAPTCHA verification failed:', {
                ip: req.ip,
                errorCodes,
                userAgent: req.headers['user-agent']
            });

            return res.status(400).json({
                error: 'reCAPTCHA verification failed. Please try again.',
                code: 'RECAPTCHA_VERIFICATION_FAILED'
            });
        }

        // Log successful verification for monitoring
        console.log('reCAPTCHA verification successful:', {
            ip: req.ip,
            score,
            action,
            hostname,
            timestamp: challenge_ts
        });

        // Add reCAPTCHA data to request for logging
        req.recaptchaData = {
            success,
            score,
            action,
            hostname,
            timestamp: challenge_ts
        };

        next();
    } catch (error) {
        console.error('reCAPTCHA verification error:', error);
        
        return res.status(500).json({
            error: 'reCAPTCHA verification service unavailable',
            code: 'RECAPTCHA_SERVICE_ERROR'
        });
    }
};

// Optional: reCAPTCHA for specific routes only
const recaptchaForRoute = (routeName) => {
    return (req, res, next) => {
        // Add route info to request
        req.recaptchaRoute = routeName;
        return verifyRecaptcha(req, res, next);
    };
};

module.exports = {
    verifyRecaptcha,
    recaptchaForRoute
}; 