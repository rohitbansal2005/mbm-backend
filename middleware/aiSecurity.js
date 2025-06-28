const Filter = require('bad-words');
const User = require('../models/User');

// Initialize bad words filter
const filter = new Filter();

// AI Security Middleware
class AISecurity {
    constructor() {
        this.suspiciousPatterns = {
            spamKeywords: [
                'buy now', 'click here', 'free money', 'make money fast',
                'earn money', 'work from home', 'get rich quick', 'lottery',
                'crypto', 'bitcoin', 'investment', 'forex', 'trading',
                'weight loss', 'diet pills', 'viagra', 'casino', 'poker'
            ],
            hateSpeech: [
                'hate', 'kill', 'death', 'suicide', 'terrorist', 'bomb',
                'racist', 'sexist', 'homophobic', 'nazi', 'hitler'
            ],
            threats: [
                'kill you', 'hurt you', 'attack', 'bomb', 'shoot',
                'threat', 'danger', 'weapon', 'gun', 'knife'
            ]
        };
        
        this.userBehaviorCache = new Map();
        this.contentAnalysisCache = new Map();
    }

    // Text Analysis and Content Moderation
    analyzeText(text) {
        if (!text || typeof text !== 'string') {
            return { safe: true, score: 100, flags: [] };
        }

        const analysis = {
            safe: true,
            score: 100,
            flags: [],
            details: {}
        };

        const lowerText = text.toLowerCase();
        const words = lowerText.split(/\s+/);

        // 1. Profanity Check
        if (filter.isProfane(text)) {
            analysis.safe = false;
            analysis.score -= 30;
            analysis.flags.push('profanity');
            analysis.details.profanity = true;
        }

        // 2. Spam Detection
        const spamCount = this.suspiciousPatterns.spamKeywords.filter(keyword => 
            lowerText.includes(keyword)
        ).length;
        
        if (spamCount > 0) {
            analysis.score -= (spamCount * 10);
            analysis.flags.push('spam');
            analysis.details.spamKeywords = spamCount;
            
            if (spamCount >= 3) {
                analysis.safe = false;
            }
        }

        // 3. Hate Speech Detection
        const hateCount = this.suspiciousPatterns.hateSpeech.filter(keyword => 
            lowerText.includes(keyword)
        ).length;
        
        if (hateCount > 0) {
            analysis.safe = false;
            analysis.score -= (hateCount * 25);
            analysis.flags.push('hate_speech');
            analysis.details.hateSpeech = hateCount;
        }

        // 4. Threat Detection
        const threatCount = this.suspiciousPatterns.threats.filter(keyword => 
            lowerText.includes(keyword)
        ).length;
        
        if (threatCount > 0) {
            analysis.safe = false;
            analysis.score -= (threatCount * 40);
            analysis.flags.push('threats');
            analysis.details.threats = threatCount;
        }

        // 5. Repetitive Text Detection
        const wordCount = words.length;
        const uniqueWords = new Set(words);
        const repetitionRatio = uniqueWords.size / wordCount;
        
        if (repetitionRatio < 0.3 && wordCount > 10) {
            analysis.score -= 20;
            analysis.flags.push('repetitive');
            analysis.details.repetitionRatio = repetitionRatio;
        }

        // 6. Excessive Caps Detection
        const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
        if (capsRatio > 0.7 && text.length > 20) {
            analysis.score -= 10;
            analysis.flags.push('excessive_caps');
            analysis.details.capsRatio = capsRatio;
        }

        // 7. URL/Email Detection (potential spam)
        const urlCount = (text.match(/https?:\/\/[^\s]+/g) || []).length;
        const emailCount = (text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).length;
        
        if (urlCount > 2 || emailCount > 1) {
            analysis.score -= 15;
            analysis.flags.push('excessive_links');
            analysis.details.urls = urlCount;
            analysis.details.emails = emailCount;
        }

        // Ensure score doesn't go below 0
        analysis.score = Math.max(0, analysis.score);

        return analysis;
    }

    // User Behavior Analysis
    async analyzeUserBehavior(userId, action, data = {}) {
        const userKey = `user_${userId}`;
        let userData = this.userBehaviorCache.get(userKey) || {
            actions: [],
            patterns: {},
            riskScore: 0,
            lastActivity: null
        };

        const now = new Date();
        const actionRecord = {
            action,
            timestamp: now,
            data
        };

        userData.actions.push(actionRecord);
        userData.lastActivity = now;

        // Keep only last 100 actions for analysis
        if (userData.actions.length > 100) {
            userData.actions = userData.actions.slice(-100);
        }

        // Analyze patterns
        const patterns = this.analyzeBehaviorPatterns(userData.actions);
        userData.patterns = patterns;

        // Calculate risk score
        const riskScore = this.calculateBehaviorRiskScore(patterns, userData.actions);
        userData.riskScore = riskScore;

        this.userBehaviorCache.set(userKey, userData);

        return {
            riskScore,
            patterns,
            isSuspicious: riskScore > 70,
            flags: this.getBehaviorFlags(patterns, riskScore)
        };
    }

    // Analyze behavior patterns
    analyzeBehaviorPatterns(actions) {
        const patterns = {
            frequency: {},
            timing: {},
            sequences: {},
            anomalies: []
        };

        if (actions.length < 5) return patterns;

        // Frequency analysis
        const actionCounts = {};
        actions.forEach(action => {
            actionCounts[action.action] = (actionCounts[action.action] || 0) + 1;
        });

        // Check for excessive frequency
        Object.entries(actionCounts).forEach(([action, count]) => {
            const timeSpan = actions[actions.length - 1].timestamp - actions[0].timestamp;
            const hours = timeSpan / (1000 * 60 * 60);
            const ratePerHour = count / hours;

            if (ratePerHour > 10) { // More than 10 actions per hour
                patterns.anomalies.push(`excessive_${action}_rate`);
            }
        });

        // Timing analysis
        const hours = actions.map(a => a.timestamp.getHours());
        const hourCounts = {};
        hours.forEach(hour => {
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        });

        // Check for 24/7 activity (suspicious)
        const activeHours = Object.keys(hourCounts).length;
        if (activeHours > 20) {
            patterns.anomalies.push('24_7_activity');
        }

        // Sequence analysis
        for (let i = 1; i < actions.length; i++) {
            const sequence = `${actions[i-1].action}_${actions[i].action}`;
            patterns.sequences[sequence] = (patterns.sequences[sequence] || 0) + 1;
        }

        return patterns;
    }

    // Calculate behavior risk score
    calculateBehaviorRiskScore(patterns, actions) {
        let riskScore = 0;

        // Anomaly penalties
        patterns.anomalies.forEach(anomaly => {
            switch (anomaly) {
                case '24_7_activity':
                    riskScore += 30;
                    break;
                case 'excessive_post_rate':
                    riskScore += 25;
                    break;
                case 'excessive_like_rate':
                    riskScore += 20;
                    break;
                case 'excessive_comment_rate':
                    riskScore += 20;
                    break;
                default:
                    riskScore += 15;
            }
        });

        // Time-based analysis
        const now = new Date();
        const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
        const recentActions = actions.filter(a => a.timestamp > lastHour);

        if (recentActions.length > 50) {
            riskScore += 40; // More than 50 actions in last hour
        } else if (recentActions.length > 20) {
            riskScore += 20; // More than 20 actions in last hour
        }

        return Math.min(100, riskScore);
    }

    // Get behavior flags
    getBehaviorFlags(patterns, riskScore) {
        const flags = [];

        if (riskScore > 70) flags.push('high_risk');
        if (riskScore > 50) flags.push('moderate_risk');
        if (patterns.anomalies.includes('24_7_activity')) flags.push('bot_like_behavior');
        if (patterns.anomalies.some(a => a.includes('excessive'))) flags.push('spam_behavior');

        return flags;
    }

    // Image Analysis (Basic)
    analyzeImage(imageData) {
        // Basic image analysis without external APIs
        const analysis = {
            safe: true,
            score: 100,
            flags: [],
            details: {}
        };

        // Check file size (suspicious if too large)
        if (imageData.size > 10 * 1024 * 1024) { // 10MB
            analysis.score -= 20;
            analysis.flags.push('large_file');
            analysis.details.fileSize = imageData.size;
        }

        // Check file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedTypes.includes(imageData.mimetype)) {
            analysis.safe = false;
            analysis.score -= 50;
            analysis.flags.push('invalid_file_type');
        }

        // Check filename for suspicious patterns
        const filename = imageData.originalname.toLowerCase();
        const suspiciousPatterns = ['virus', 'malware', 'hack', 'crack', 'keygen'];
        
        if (suspiciousPatterns.some(pattern => filename.includes(pattern))) {
            analysis.safe = false;
            analysis.score -= 40;
            analysis.flags.push('suspicious_filename');
        }

        return analysis;
    }

    // Real-time threat detection
    detectThreats(userId, action, data) {
        const threats = [];

        // Rate limiting threats
        const userKey = `rate_${userId}`;
        const now = Date.now();
        const userRate = this.userBehaviorCache.get(userKey) || { count: 0, resetTime: now + 60000 };

        if (now > userRate.resetTime) {
            userRate.count = 0;
            userRate.resetTime = now + 60000;
        }

        userRate.count++;
        this.userBehaviorCache.set(userKey, userRate);

        if (userRate.count > 100) { // More than 100 actions per minute
            threats.push('rate_limit_exceeded');
        }

        // Content-based threats
        if (data.content) {
            const contentAnalysis = this.analyzeText(data.content);
            if (!contentAnalysis.safe) {
                threats.push('harmful_content');
            }
        }

        return threats;
    }

    // Generate security report
    async generateSecurityReport(userId) {
        const user = await User.findById(userId);
        if (!user) return null;

        const userKey = `user_${userId}`;
        const userData = this.userBehaviorCache.get(userKey);

        const report = {
            userId,
            username: user.username,
            riskScore: userData?.riskScore || 0,
            behaviorFlags: userData?.patterns?.anomalies || [],
            lastActivity: userData?.lastActivity,
            accountAge: Date.now() - user.createdAt.getTime(),
            isSuspicious: (userData?.riskScore || 0) > 70,
            recommendations: []
        };

        // Generate recommendations
        if (report.riskScore > 70) {
            report.recommendations.push('Consider temporary suspension');
        } else if (report.riskScore > 50) {
            report.recommendations.push('Monitor user activity closely');
        }

        if (report.behaviorFlags.includes('24_7_activity')) {
            report.recommendations.push('Check for bot activity');
        }

        return report;
    }
}

// Create singleton instance
const aiSecurity = new AISecurity();

// Middleware function
const aiSecurityMiddleware = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        
        if (userId) {
            // Analyze user behavior
            const behaviorAnalysis = await aiSecurity.analyzeUserBehavior(
                userId, 
                req.method + '_' + req.path,
                req.body
            );

            // Add analysis to request
            req.aiSecurity = {
                behavior: behaviorAnalysis,
                textAnalysis: null,
                imageAnalysis: null,
                threats: []
            };

            // Analyze text content if present
            if (req.body.content || req.body.text || req.body.message) {
                const text = req.body.content || req.body.text || req.body.message;
                req.aiSecurity.textAnalysis = aiSecurity.analyzeText(text);
            }

            // Analyze image if present
            if (req.file) {
                req.aiSecurity.imageAnalysis = aiSecurity.analyzeImage(req.file);
            }

            // Detect threats
            req.aiSecurity.threats = aiSecurity.detectThreats(userId, req.method + '_' + req.path, req.body);

            // Log suspicious activity
            if (behaviorAnalysis.isSuspicious || req.aiSecurity.threats.length > 0) {
                console.log('🚨 AI Security Alert:', {
                    userId,
                    path: req.path,
                    behaviorScore: behaviorAnalysis.riskScore,
                    threats: req.aiSecurity.threats,
                    flags: behaviorAnalysis.flags
                });
            }
        }

        next();
    } catch (error) {
        console.error('AI Security Middleware Error:', error);
        next(); // Continue even if AI analysis fails
    }
};

module.exports = {
    aiSecurity,
    aiSecurityMiddleware
}; 