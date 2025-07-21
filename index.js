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
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' });
    }

    // Log environment check (safe for debugging)
    console.log('Token exchange request - Code:', code.substring(0, 10) + '...');
    console.log('Environment check:', {
      clientId: process.env.PAYMAN_CLIENT_ID ? 'Present' : 'Missing',
      clientSecret: process.env.PAYMAN_CLIENT_SECRET ? 'Present' : 'Missing'
    });

    // Validate environment variables
    if (!process.env.PAYMAN_CLIENT_ID || !process.env.PAYMAN_CLIENT_SECRET) {
      return res.status(500).json({ 
        error: 'Server configuration error - missing credentials' 
      });
    }

    let tokenResponse;
    
    // Try Payman SDK first
    try {
      const pkg = await import('@paymanai/payman-ts');
      const { PaymanClient } = pkg;

      const client = PaymanClient.withAuthCode(
        {
          clientId: process.env.PAYMAN_CLIENT_ID,
          clientSecret: process.env.PAYMAN_CLIENT_SECRET,
        },
        code
      );

      tokenResponse = await client.getAccessToken();
      console.log('SDK response type:', typeof tokenResponse);
      console.log('SDK response keys:', tokenResponse ? Object.keys(tokenResponse) : 'null/undefined');
      
    } catch (sdkError) {
      console.error('SDK failed:', sdkError.message);
      
      // Fallback to direct API call
      try {
        const response = await fetch('https://app.paymanai.com/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${process.env.PAYMAN_CLIENT_ID}:${process.env.PAYMAN_CLIENT_SECRET}`).toString('base64')}`
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API call failed: ${response.status} ${errorText}`);
        }

        tokenResponse = await response.json();
        console.log('Direct API response type:', typeof tokenResponse);
        
      } catch (apiError) {
        console.error('Direct API also failed:', apiError.message);
        return res.status(500).json({ 
          error: 'Both SDK and direct API failed',
          details: apiError.message 
        });
      }
    }

    // Robust response handling with detailed logging
    if (!tokenResponse) {
      console.error('Token response is null/undefined');
      return res.status(500).json({ 
        error: 'No response from Payman servers'
      });
    }

    // Handle multiple possible response formats
    const accessToken = tokenResponse.accessToken || 
                       tokenResponse.access_token || 
                       tokenResponse.token ||
                       null;
                       
    const expiresIn = tokenResponse.expiresIn || 
                     tokenResponse.expires_in || 
                     tokenResponse.expiry ||
                     3600;

    if (!accessToken) {
      console.error('No access token found in response:', {
        keys: Object.keys(tokenResponse),
        sample: JSON.stringify(tokenResponse).substring(0, 200)
      });
      return res.status(500).json({ 
        error: 'No access token in Payman response',
        responseKeys: Object.keys(tokenResponse)
      });
    }

    console.log('Success: Token extracted');
    res.json({
      accessToken,
      expiresIn,
    });
    
  } catch (error) {
    console.error('Unexpected error in token exchange:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
});

// OAuth callback endpoint (where Payman redirects after user consent)
app.get('/api/oauth/callback', async (req, res) => {
  const { code, error, error_description, state } = req.query;

  console.log('OAuth callback received:', {
    hasCode: !!code,
    hasError: !!error,
    codeLength: code ? code.length : 0
  });

  // Determine redirect base URL
  const getRedirectBase = () => {
    const referer = req.get('Referer');
    console.log('Referer:', referer);
    
    if (referer && referer.includes('localhost')) {
      if (referer.includes(':8080')) return 'http://localhost:8080';
      if (referer.includes(':5173')) return 'http://localhost:5173';
      if (referer.includes(':3000')) return 'http://localhost:3000';
    }
    return 'https://auto-cart.vercel.app';
  };

  const redirectBase = getRedirectBase();
  console.log('Will redirect to:', redirectBase);

  if (error) {
    console.error('OAuth Error from Payman:', error, error_description);
    return res.redirect(
      `${redirectBase}/dashboard?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || '')}`
    );
  }

  if (!code) {
    console.error('Missing authorization code in callback');
    return res.redirect(
      `${redirectBase}/dashboard?error=missing_code&error_description=${encodeURIComponent('No authorization code received')}`
    );
  }

  try {
    // Exchange code for token using the same logic as the POST endpoint
    const tokenExchangeUrl = `${req.protocol}://${req.get('host')}/api/oauth/token`;
    console.log('Calling internal token exchange:', tokenExchangeUrl);
    
    const response = await fetch(tokenExchangeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });

    const data = await response.json();
    console.log('Token exchange result:', {
      success: response.ok,
      status: response.status,
      hasAccessToken: !!data.accessToken
    });

    if (!response.ok) {
      throw new Error(data.error || `Token exchange failed with status ${response.status}`);
    }

    // Success - redirect with token
    const redirectUrl = `${redirectBase}/dashboard?access_token=${encodeURIComponent(data.accessToken)}&expires_in=${encodeURIComponent(data.expiresIn)}`;
    console.log('Redirecting to dashboard with token');
    res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('Callback processing error:', error);
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
    message: 'AutoCart Backend API - Robust Version',
    status: 'running',
    timestamp: new Date().toISOString(),
    version: '1.1.0',
    endpoints: [
      'GET /health - Health check',
      'POST /api/oauth/token - Exchange OAuth code for token',
      'GET /api/oauth/callback - OAuth callback handler'
    ]
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`AutoCart Backend v1.1.0 running on port ${PORT}`);
  console.log(`Health: ${process.env.RENDER_EXTERNAL_URL || 'localhost'}/health`);
});
