const express = require('express');
const cors = require('cors');
const app = express();

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://mbm-frontend-blond.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ... rest of your backend code ...

// Port configuration
const PORT = process.env.PORT || 10000;

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 