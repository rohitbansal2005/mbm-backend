const axios = require('axios');

// reCAPTCHA Verification Middleware
const verifyRecaptcha = async (req, res, next) => {
    try {
        const { recaptchaToken } = req.body;
        
        // Check if reCAPTCHA is properly configured
        if (!process.env.RECAPTCHA_SECRET_KEY) {
            console.error('reCAPTCHA: SECRET_KEY not configured - verification required');
            return res.status(500).json({
                error: 'reCAPTCHA not properly configured. Please contact administrator.',
                code: 'RECAPTCHA_NOT_CONFIGURED'
            });
        }
        
        if (!recaptchaToken) {
            return res.status(400).json({
                error: 'reCAPTCHA token is required',
                code: 'RECAPTCHA_TOKEN_MISSING'
            });
        }

        // Remove development mode bypass - require actual verification
        if (recaptchaToken === 'development-mode' || recaptchaToken === '') {
            return res.status(400).json({
                error: 'reCAPTCHA verification required. Please complete the verification.',
                code: 'RECAPTCHA_VERIFICATION_REQUIRED'
            });
        }

        // Verify with Google reCAPTCHA API
        const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
        const secretKey = process.env.RECAPTCHA_SECRET_KEY;
        
        const response = await axios.post(
            verificationUrl,
            new URLSearchParams({
                secret: secretKey,
                response: recaptchaToken,
                remoteip: req.ip
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

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

        // Strict hostname check
        const expectedHostname = process.env.RECAPTCHA_HOSTNAME || 'localhost';
        if (hostname !== expectedHostname) {
            console.warn('reCAPTCHA hostname mismatch:', {
                expected: expectedHostname,
                received: hostname,
                ip: req.ip
            });
            return res.status(400).json({
                error: 'reCAPTCHA hostname mismatch',
                code: 'RECAPTCHA_HOSTNAME_MISMATCH'
            });
        }

        // If v3, require minimum score
        if (typeof score === 'number' && score < 0.7) {
            console.warn('reCAPTCHA score too low:', {
                score,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(400).json({
                error: 'reCAPTCHA score too low. Are you a bot?',
                code: 'RECAPTCHA_SCORE_LOW',
                score
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
        
        // Don't allow requests to proceed on error - require proper verification
        return res.status(500).json({
            error: 'reCAPTCHA verification service unavailable. Please try again later.',
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