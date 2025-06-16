import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors({ origin: "https://auto-cart.vercel.app" }));
app.use(express.json());

// Token exchange endpoint
app.post('/api/oauth/token', async (req, res) => {
  try {
    const pkg = await import('@paymanai/payman-ts');
    const { PaymanClient } = pkg;

    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Missing code parameter' });
    }

    const client = PaymanClient.withAuthCode(
      {
        clientId: process.env.PAYMAN_CLIENT_ID,
        clientSecret: process.env.PAYMAN_CLIENT_SECRET,
      },
      code
    );

    const tokenResponse = await client.getAccessToken();

    res.json({
      accessToken: tokenResponse.accessToken,
      expiresIn: tokenResponse.expiresIn,
    });
  } catch (error) {
    console.error('Token exchange failed:', error);
    res.status(500).json({ error: error.message || 'Token exchange failed' });
  }
});

// OAuth callback endpoint
app.get('/api/oauth/callback', async (req, res) => {
  const { code, error, error_description, state } = req.query;

  if (error) {
    // Redirect to frontend with error details
    return res.redirect(
      `https://auto-cart.vercel.app/dashboard?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(error_description || '')}`
    );
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  // TODO: Validate the `state` parameter for CSRF protection
  // Example: Compare `state` with a stored value in a session or cookie

  try {
    // Exchange code for access token using the /api/oauth/token endpoint
    const response = await fetch('https://autocart-backend-8o8e.onrender.com/api/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Token exchange failed');
    }

    // Redirect to frontend with the access token
    res.redirect(
      `https://auto-cart.vercel.app/dashboard?access_token=${encodeURIComponent(data.accessToken)}&expires_in=${encodeURIComponent(data.expiresIn)}`
    );
  } catch (error) {
    console.error('Token Exchange Error:', error);
    res.redirect(
      `https://auto-cart.vercel.app/dashboard?error=token_exchange_failed&error_description=${encodeURIComponent(error.message)}`
    );
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});