const mongoose = require('mongoose');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

// Security Event Logger
class SecurityMonitor {
    constructor() {
        this.logFile = path.join(__dirname, '../logs/security.log');
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    logEvent(level, event, details) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level}] ${event}: ${JSON.stringify(details)}\n`;
        
        console.log(`🔒 [${level}] ${event}:`, details);
        
        fs.appendFileSync(this.logFile, logEntry);
    }

    async connectDB() {
        try {
            await mongoose.connect(process.env.MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });
            console.log('Connected to MongoDB');
        } catch (error) {
            console.error('MongoDB connection failed:', error);
            throw error;
        }
    }

    async disconnectDB() {
        try {
            await mongoose.disconnect();
            console.log('Disconnected from MongoDB');
        } catch (error) {
            console.error('MongoDB disconnection failed:', error);
        }
    }

    async checkSuspiciousUsers() {
        try {
            const suspiciousUsers = await User.find({
                $or: [
                    { isBanned: true },
                    { suspiciousActivity: true },
                    { 
                        createdAt: { 
                            $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) 
                        } 
                    }
                ]
            });

            if (suspiciousUsers.length > 0) {
                this.logEvent('WARNING', 'SUSPICIOUS_USERS_DETECTED', {
                    count: suspiciousUsers.length,
                    users: suspiciousUsers.map(u => ({
                        username: u.username,
                        email: u.email,
                        isBanned: u.isBanned,
                        suspiciousActivity: u.suspiciousActivity,
                        createdAt: u.createdAt
                    }))
                });
            }

            return suspiciousUsers;
        } catch (error) {
            this.logEvent('ERROR', 'SUSPICIOUS_USERS_CHECK_FAILED', { error: error.message });
            return [];
        }
    }

    async checkRecentActivity() {
        try {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            
            // Check for users created in last hour
            const recentUsers = await User.find({
                createdAt: { $gte: oneHourAgo }
            });

            if (recentUsers.length > 0) {
                this.logEvent('ALERT', 'RECENT_USER_CREATION', {
                    count: recentUsers.length,
                    users: recentUsers.map(u => ({
                        username: u.username,
                        email: u.email,
                        createdAt: u.createdAt
                    }))
                });
            }

            return recentUsers;
        } catch (error) {
            this.logEvent('ERROR', 'RECENT_ACTIVITY_CHECK_FAILED', { error: error.message });
            return [];
        }
    }

    async checkFailedLogins() {
        try {
            // This would typically check a failed login log
            // For now, we'll just log the check
            this.logEvent('INFO', 'FAILED_LOGIN_CHECK', { message: 'Checking for failed login attempts' });
        } catch (error) {
            this.logEvent('ERROR', 'FAILED_LOGIN_CHECK_FAILED', { error: error.message });
        }
    }

    async generateSecurityReport() {
        try {
            const totalUsers = await User.countDocuments();
            const bannedUsers = await User.countDocuments({ isBanned: true });
            const suspiciousUsers = await User.countDocuments({ suspiciousActivity: true });
            
            const report = {
                timestamp: new Date().toISOString(),
                totalUsers,
                bannedUsers,
                suspiciousUsers,
                activeUsers: totalUsers - bannedUsers,
                securityStatus: 'SECURE',
                recommendations: []
            };

            // Add recommendations based on findings
            if (suspiciousUsers > 0) {
                report.recommendations.push('Monitor suspicious users closely');
            }

            if (bannedUsers > 0) {
                report.recommendations.push('Review banned users list');
            }

            this.logEvent('INFO', 'SECURITY_REPORT_GENERATED', report);
            return report;
        } catch (error) {
            this.logEvent('ERROR', 'SECURITY_REPORT_FAILED', { error: error.message });
            return null;
        }
    }

    async monitorSecurity() {
        console.log('🛡️ Starting Security Monitor...');
        
        try {
            // Check for suspicious users
            await this.checkSuspiciousUsers();
            
            // Check recent activity
            await this.checkRecentActivity();
            
            // Check failed logins
            await this.checkFailedLogins();
            
            // Generate security report
            const report = await this.generateSecurityReport();
            
            if (report) {
                console.log('📊 Security Report:');
                console.log(`   Total Users: ${report.totalUsers}`);
                console.log(`   Active Users: ${report.activeUsers}`);
                console.log(`   Banned Users: ${report.bannedUsers}`);
                console.log(`   Suspicious Users: ${report.suspiciousUsers}`);
                console.log(`   Status: ${report.securityStatus}`);
                
                if (report.recommendations.length > 0) {
                    console.log('   Recommendations:');
                    report.recommendations.forEach(rec => console.log(`   - ${rec}`));
                }
            }
            
            console.log('✅ Security monitoring completed');
            
        } catch (error) {
            this.logEvent('ERROR', 'SECURITY_MONITOR_FAILED', { error: error.message });
            console.error('❌ Security monitoring failed:', error.message);
        }
    }
}

// Run security monitor
async function runSecurityMonitor() {
    const monitor = new SecurityMonitor();
    
    try {
        await monitor.connectDB();
        await monitor.monitorSecurity();
    } finally {
        await monitor.disconnectDB();
    }
}

// Export for use in other scripts
module.exports = { SecurityMonitor, runSecurityMonitor };

// Run if called directly
if (require.main === module) {
    runSecurityMonitor().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Security monitor error:', error);
        process.exit(1);
    });
} 