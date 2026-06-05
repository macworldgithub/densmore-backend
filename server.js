require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const KNOWLEDGE_BASE = require('./knowledgeBase');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// System prompt using knowledge base
const SYSTEM_PROMPT = `You are a friendly and knowledgeable insurance assistant for Densmore Insurance Strategies, Inc., an independent insurance agency in Bondurant, Iowa. 

Use ONLY the following knowledge base to answer questions. If a question is outside the scope of what's provided, politely say you don't have that specific information and suggest the user call (515) 967-3390 or email info@densmoreis.com.

Always be:
- Warm, professional, and helpful
- Specific with coverage details and pricing when available
- Honest about limitations — recommend calling for exact quotes
- Brief for simple questions, detailed for complex ones
- Encouraging users to get a free quote when appropriate

KNOWLEDGE BASE:
${KNOWLEDGE_BASE}

IMPORTANT RULES:
1. Never make up coverage details, prices, or policies not in the knowledge base.
2. Always recommend calling or getting a free quote for specific pricing.
3. If asked about claims, direct them to call (515) 967-3390 or visit the office.
4. Keep responses concise but complete — use bullet points for lists of coverages.
5. Use a conversational, friendly tone — not robotic or overly formal.`;

// In-memory conversation store (keyed by session ID)
const conversations = new Map();

// Clean up old sessions every hour (sessions older than 2 hours)
setInterval(() => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const [sessionId, session] of conversations.entries()) {
    if (session.lastActivity < twoHoursAgo) {
      conversations.delete(sessionId);
    }
  }
}, 60 * 60 * 1000);

// ─── ROUTES ───────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Densmore Insurance Chatbot is running' });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required.' });
    }

    // Limit message length
    const trimmedMessage = message.trim().slice(0, 1000);

    // Get or create conversation history
    if (!conversations.has(sessionId)) {
      conversations.set(sessionId, { messages: [], lastActivity: Date.now() });
    }

    const session = conversations.get(sessionId);
    session.lastActivity = Date.now();

    // Add user message to history
    session.messages.push({ role: 'user', content: trimmedMessage });

    // Keep only last 20 messages to stay within token limits
    if (session.messages.length > 20) {
      session.messages = session.messages.slice(-20);
    }

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...session.messages,
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    const assistantMessage = completion.choices[0].message.content;

    // Add assistant response to history
    session.messages.push({ role: 'assistant', content: assistantMessage });

    res.json({
      reply: assistantMessage,
      sessionId,
      usage: completion.usage,
    });
  } catch (error) {
    console.error('OpenAI API Error:', error);

    if (error.code === 'invalid_api_key') {
      return res.status(401).json({ error: 'Invalid OpenAI API key. Please check your .env file.' });
    }
    if (error.code === 'insufficient_quota') {
      return res.status(429).json({ error: 'OpenAI quota exceeded. Please check your billing.' });
    }

    res.status(500).json({ error: 'Something went wrong. Please try again or call us at (515) 967-3390.' });
  }
});

// Clear conversation history for a session
app.delete('/api/chat/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  conversations.delete(sessionId);
  res.json({ message: 'Conversation cleared.' });
});

// Serve the frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🏢 Densmore Insurance Chatbot`);
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`📋 API endpoint: http://localhost:${PORT}/api/chat`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  WARNING: OPENAI_API_KEY not set in .env file!');
  }
});

module.exports = app;
