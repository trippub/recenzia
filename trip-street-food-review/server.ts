import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import helmet from 'helmet';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import firebaseConfig from './firebase-applet-config.json' assert { type: 'json' };

// Initialize Firebase Admin
const adminApp = admin.initializeApp({
  projectId: firebaseConfig.projectId,
});

const db = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);

// Initialize Resend (if API key is provided)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());
  app.use(helmet({
    contentSecurityPolicy: false, // Disable for dev/iframe compatibility
  }));

  // Simple IP-based spam protection (in-memory for now)
  const ipLimits = new Map<string, number>();

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // API Routes
  app.post('/api/feedback', async (req, res) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const lastSubmission = ipLimits.get(ip);

    if (lastSubmission && now - lastSubmission < 3600000) { // 1 hour
      return res.status(429).json({ error: 'Môžete odoslať iba jednu recenziu za hodinu.' });
    }

    const { rating, food, service, atmosphere, message, contact, photos } = req.body;

    if (!message || message.length < 10) {
      return res.status(400).json({ error: 'Správa musí mať aspoň 10 znakov.' });
    }

    try {
      // Save to Firestore
      await db.collection('reviews').add({
        rating,
        food: food || 0,
        service: service || 0,
        atmosphere: atmosphere || 0,
        message,
        contact: contact || '',
        photos: photos || [],
        ip,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update IP limit
      ipLimits.set(ip, now);

      // Email notification
      if (resend) {
        try {
          await resend.emails.send({
            from: 'TriP Review <onboarding@resend.dev>',
            to: process.env.OWNER_EMAIL || 'admin@example.com', // Configurable owner email
            subject: `Nová negatívna recenzia (${rating}*) - TriP street food & Pub`,
            html: `
              <h2>Nová negatívna recenzia</h2>
              <p><strong>Hodnotenie:</strong> ${rating} hviezdičiek</p>
              <p><strong>Jedlo:</strong> ${food}/5, <strong>Obsluha:</strong> ${service}/5, <strong>Atmosféra:</strong> ${atmosphere}/5</p>
              <p><strong>Správa:</strong> ${message}</p>
              <p><strong>Kontakt:</strong> ${contact || 'Neuvedený'}</p>
              <p><strong>IP:</strong> ${ip}</p>
              ${photos && photos.length > 0 ? `<p><strong>Fotky:</strong> ${photos.length} nahraných</p>` : ''}
            `,
          });
          console.log('Email notification sent successfully');
        } catch (emailError) {
          console.error('Error sending email notification:', emailError);
        }
      } else {
        console.log('Resend API key missing, skipping email notification');
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error saving feedback to Firestore:', error);
      res.status(500).json({ error: 'Nastala chyba pri ukladaní spätnej väzby.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
