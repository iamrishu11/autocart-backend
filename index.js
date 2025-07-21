import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors({ 
  origin: [
    "https://auto-cart.vercel.app",
    "http://localhost:8080",
    "http://localhost:5173",
    "http://localhost:3000"
  ],
  credentials: true
}));
app.use(express.json());

// Token exchange endpoint (for frontend AJAX calls)
app.post('/api/oauth/token', async (req, res) => {
  try {
    const pkg = await import('@paymanai/payman-ts');
    const { PaymanClient } = pkg;

    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' });
    }

    console.log('Token exchange request - Code:', code);
    console.log('Environment:', {
      clientId: process.env.PAYMAN_CLIENT_ID ? 'Present' : 'Missing',
      clientSecret: process.env.PAYMAN_CLIENT_SECRET ? 'Present' : 'Missing'
    });

    const client = PaymanClient.withAuthCode(
      {
        clientId: process.env.PAYMAN_CLIENT_ID,
        clientSecret: process.env.PAYMAN_CLIENT_SECRET,
      },
      code
    );

    const tokenResponse = await client.getAccessToken();
    
    console.log('Token response received:', tokenResponse);

    // Handle different possible response formats with null checks
    if (!tokenResponse) {
      console.error('No response from token exchange');
      return res.status(500).json({ error: 'No response from token exchange' });
    }

    const accessToken = tokenResponse.accessToken || tokenResponse.access_token;
    const expiresIn = tokenResponse.expiresIn || tokenResponse.expires_in || 3600;

    if (!accessToken) {
      console.error('No access token in response:', tokenResponse);
      return res.status(500).json({ error: 'No access token received from Payman' });
    }

    res.json({
      accessToken,
      expiresIn,
    });
  } catch (error) {
    console.error('Token exchange failed:', error);
    res.status(500).json({ error: error.message || 'Token exchange failed' });
  }
});

// OAuth callback endpoint (where Payman redirects after user consent)
app.get('/api/oauth/callback', async (req, res) => {
  const { code, error, error_description, state } = req.query;

  // Determine redirect base URL based on referrer or default to production
  const getRedirectBase = () => {
    const referer = req.get('Referer');
    if (referer && referer.includes('localhost')) {
      if (referer.includes(':8080')) return 'http://localhost:8080';
      if (referer.includes(':5173')) return 'http://localhost:5173';
      if (referer.includes(':3000')) return 'http://localhost:3000';
    }
    return 'https://auto-cart.vercel.app';
  };

  const redirectBase = getRedirectBase();

  if (error) {
    console.error('OAuth Error:', error, error_description);
    return res.redirect(
      `${redirectBase}/dashboard?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || '')}`
    );
  }

  if (!code) {
    console.error('Missing authorization code');
    return res.redirect(
      `${redirectBase}/dashboard?error=missing_code&error_description=${encodeURIComponent('No authorization code received')}`
    );
  }

  try {
    // DIRECTLY exchange code for token using Payman SDK (not HTTP call)
    const pkg = await import('@paymanai/payman-ts');
    const { PaymanClient } = pkg;

    console.log('Exchanging code:', code);
    
    const client = PaymanClient.withAuthCode(
      {
        clientId: process.env.PAYMAN_CLIENT_ID,
        clientSecret: process.env.PAYMAN_CLIENT_SECRET,
      },
      code
    );

    const tokenResponse = await client.getAccessToken();
    
    console.log('Token response received:', tokenResponse);

    // Handle different possible response formats with null checks
    if (!tokenResponse) {
      throw new Error('No response from token exchange');
    }

    const accessToken = tokenResponse.accessToken || tokenResponse.access_token;
    const expiresIn = tokenResponse.expiresIn || tokenResponse.expires_in || 3600;

    if (!accessToken) {
      console.error('No access token in callback response:', tokenResponse);
      throw new Error('No access token received from Payman');
    }
    
    console.log('Token exchange successful');

    // Redirect to frontend with the access token
    res.redirect(
      `${redirectBase}/dashboard?access_token=${encodeURIComponent(accessToken)}&expires_in=${encodeURIComponent(expiresIn)}`
    );
  } catch (error) {
    console.error('Token Exchange Error:', error);
    res.redirect(
      `${redirectBase}/dashboard?error=token_exchange_failed&error_description=${encodeURIComponent(error.message)}`
    );
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: {
      PAYMAN_CLIENT_ID: process.env.PAYMAN_CLIENT_ID ? 'Present' : 'Missing',
      PAYMAN_CLIENT_SECRET: process.env.PAYMAN_CLIENT_SECRET ? 'Present' : 'Missing',
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'AutoCart Backend API',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /health - Health check',
      'POST /api/oauth/token - Exchange OAuth code for token',
      'GET /api/oauth/callback - OAuth callback handler'
    ]
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
