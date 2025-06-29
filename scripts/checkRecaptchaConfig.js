require('dotenv').config();

console.log('🔍 Checking reCAPTCHA Configuration...\n');

// Check backend configuration
console.log('📋 Backend Configuration:');
const backendSecretKey = process.env.RECAPTCHA_SECRET_KEY;
const backendHostname = process.env.RECAPTCHA_HOSTNAME;

if (backendSecretKey) {
    console.log('   ✅ RECAPTCHA_SECRET_KEY is set');
    console.log(`   📝 Secret Key: ${backendSecretKey.substring(0, 10)}...${backendSecretKey.substring(backendSecretKey.length - 4)}`);
} else {
    console.log('   ❌ RECAPTCHA_SECRET_KEY is NOT set');
    console.log('   💡 Add RECAPTCHA_SECRET_KEY to your .env file');
}

if (backendHostname) {
    console.log(`   ✅ RECAPTCHA_HOSTNAME is set to: ${backendHostname}`);
} else {
    console.log('   ⚠️  RECAPTCHA_HOSTNAME is NOT set (will use localhost)');
}

// Check frontend configuration
console.log('\n🌐 Frontend Configuration:');
const frontendSiteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;

if (frontendSiteKey) {
    console.log('   ✅ REACT_APP_RECAPTCHA_SITE_KEY is set');
    console.log(`   📝 Site Key: ${frontendSiteKey.substring(0, 10)}...${frontendSiteKey.substring(frontendSiteKey.length - 4)}`);
} else {
    console.log('   ❌ REACT_APP_RECAPTCHA_SITE_KEY is NOT set');
    console.log('   💡 Add REACT_APP_RECAPTCHA_SITE_KEY to your frontend .env file');
}

// Check environment
console.log('\n🏗️  Environment:');
const nodeEnv = process.env.NODE_ENV || 'development';
console.log(`   📊 NODE_ENV: ${nodeEnv}`);

// Summary
console.log('\n📊 Summary:');
if (backendSecretKey && frontendSiteKey) {
    console.log('   ✅ reCAPTCHA is properly configured');
    console.log('   🎯 Users will need to complete reCAPTCHA verification');
} else {
    console.log('   ❌ reCAPTCHA is NOT properly configured');
    console.log('   ⚠️  Users can bypass verification (security risk)');
    console.log('\n   🔧 To fix:');
    console.log('   1. Get reCAPTCHA keys from https://www.google.com/recaptcha/admin');
    console.log('   2. Add RECAPTCHA_SECRET_KEY to backend .env');
    console.log('   3. Add REACT_APP_RECAPTCHA_SITE_KEY to frontend .env');
    console.log('   4. Restart both servers');
}

console.log('\n🔗 Get reCAPTCHA keys: https://www.google.com/recaptcha/admin');
console.log('📖 Setup guide: backend/SECURITY_SETUP.md'); 