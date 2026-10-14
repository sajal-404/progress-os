import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '2mb' }));

// Initialize GoogleGenAI client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.GEMINI_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// Helper to strip markdown and extract clean JSON
const cleanAndParseJson = (rawText: string) => {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
};

// Helper for error response
const handleGeminiError = (res: Response, error: unknown, fallbackMessage: string) => {
  console.error('Gemini API Error:', error);
  let message = error instanceof Error ? error.message : fallbackMessage;
  try {
    const parsed = JSON.parse(message);
    if (parsed?.error?.message) {
      message = parsed.error.message;
    }
  } catch {
    // Keep raw string
  }
  res.status(500).json({ error: message });
};

// 1. Daily Summary Endpoint
app.post('/api/gemini/daily-summary', async (req: Request, res: Response) => {
  const ai = getGeminiClient();
  if (!ai) {
    res.status(400).json({
      error: 'GEMINI_API_KEY is not configured. Please configure it in Settings > Secrets to unlock AI features.',
    });
    return;
  }

  const { tasks, goals, categories, streak, consistencyScore } = req.body;

  const prompt = `You are the executive AI Analyst inside ProgressOS, a personal life operating system.
Analyze the user's real-time productivity data and generate an executive daily progress summary.

Current User Context:
- Current Streak: ${streak || 0} days
- Consistency Score: ${consistencyScore || 0}%
- Categories: ${JSON.stringify(categories || [])}
- Tasks Snapshot: ${JSON.stringify(tasks || [])}
- Active Goals: ${JSON.stringify(goals || [])}

Instructions:
1. Provide a sharp, punchy, motivating daily briefing (3-4 sentences).
2. Clearly distinguish between recorded facts (e.g. completed tasks, remaining obligations) and your strategic recommendations.
3. Call out one primary high-leverage focus item for today.
4. Flag any at-risk goal or category that has had zero activity recently.
5. Keep the tone ambitious, supportive, and precise. No generic fluff.

Format your response as a valid JSON object matching:
{
  "greeting": "A crisp greeting acknowledging today's status",
  "summary": "The 3-4 sentence analytical briefing",
  "topPriority": "The single most important task or focus area for today",
  "watchout": "A specific risk or category that is lagging",
  "momentumTip": "One actionable tactical tip to maintain flow"
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '{}';
    const parsed = cleanAndParseJson(text);
    res.json(parsed);
  } catch (error) {
    handleGeminiError(res, error, 'Failed to generate daily summary');
  }
});

// 2. Comprehensive Progress Analysis Endpoint
app.post('/api/gemini/analyze', async (req: Request, res: Response) => {
  const ai = getGeminiClient();
  if (!ai) {
    res.status(400).json({
      error: 'GEMINI_API_KEY is not configured. Please configure it in Settings > Secrets.',
    });
    return;
  }

  const { tasks, goals, categories, history, timeRange } = req.body;

  const prompt = `You are ProgressOS's Lead Growth & Productivity Strategist.
Conduct an in-depth, rigorous, objective analysis of the user's performance data.

Time Horizon: ${timeRange || 'All Time'}
Categories: ${JSON.stringify(categories || [])}
Tasks Logged: ${JSON.stringify(tasks || [])}
Goals & Milestones: ${JSON.stringify(goals || [])}
Recent Activity / History: ${JSON.stringify(history || [])}

Analytical Mandates:
1. Calculate and analyze consistency patterns (streak resilience, completion velocity).
2. Category balance: Evaluate which areas are thriving and which are starving.
3. Goal velocity: Identify which long-term goals are receiving insufficient daily task execution.
4. Distinguish explicitly between "Recorded Facts" (actual numbers from data) and "Strategic Recommendations".
5. Never shame the user for missed tasks; frame them constructively as capacity calibrations.

Format your response as a valid JSON object with this exact structure:
{
  "recordedFacts": [
    "String stating a direct statistical fact from their data (e.g., '14 of 18 tasks completed this week (77.7%)')",
    "String stating time spent distribution or category volume",
    "String highlighting goal progress metric"
  ],
  "consistencyPatterns": {
    "score": "e.g., 85/100",
    "trend": "improving | stable | volatile",
    "observation": "2-3 sentences explaining their consistency rhythm"
  },
  "categoryBalance": [
    {
      "categoryName": "Category name",
      "status": "balanced | neglected | high_focus",
      "insight": "Specific observation on attention given to this category"
    }
  ],
  "goalsNeedingAttention": [
    {
      "goalTitle": "Goal Title",
      "reason": "Why this goal is falling behind based on actual task data",
      "suggestedAction": "Immediate step to revive momentum"
    }
  ],
  "recommendations": [
    {
      "title": "Actionable recommendation title",
      "details": "Concrete instructions on how to execute",
      "priority": "high | medium"
    }
  ],
  "executiveVerdict": "A 2-sentence closing high-level assessment and encouragement."
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '{}';
    const parsed = cleanAndParseJson(text);
    res.json(parsed);
  } catch (error) {
    handleGeminiError(res, error, 'Failed to complete comprehensive progress analysis');
  }
});

// 3. Goal Breakdown Endpoint
app.post('/api/gemini/breakdown-goal', async (req: Request, res: Response) => {
  const ai = getGeminiClient();
  if (!ai) {
    res.status(400).json({
      error: 'GEMINI_API_KEY is not configured.',
    });
    return;
  }

  const { title, description, category, timeframe, targetDate } = req.body;

  const prompt = `You are a Master Strategic Goal Architect.
The user wants to achieve this long-term goal:
- Title: "${title}"
- Description: "${description || 'None provided'}"
- Category: "${category || 'General'}"
- Timeframe: "${timeframe || '3-6 months'}"
- Target Deadline: "${targetDate || 'Not specified'}"

Deconstruct this goal into:
1. 4 to 6 logical, sequential, milestone phases with clear deliverable descriptions.
2. 5 to 7 concrete starter daily/weekly actionable tasks that immediately jumpstart progress.

Format your response as a valid JSON object:
{
  "strategyOverview": "2-3 sentences describing the optimal progression path",
  "milestones": [
    {
      "title": "Milestone title",
      "description": "What defines completion of this milestone",
      "targetPeriod": "e.g., Week 1-2, Month 1, etc.",
      "weight": 20
    }
  ],
  "suggestedTasks": [
    {
      "name": "Actionable task name",
      "description": "Clear execution details",
      "estimatedMinutes": 45,
      "priority": "High" | "Medium" | "Low",
      "targetMilestoneIndex": 0
    }
  ]
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '{}';
    const parsed = cleanAndParseJson(text);
    res.json(parsed);
  } catch (error) {
    handleGeminiError(res, error, 'Failed to break down goal');
  }
});

// 4. Daily Review AI Summary
app.post('/api/gemini/daily-review', async (req: Request, res: Response) => {
  const ai = getGeminiClient();
  if (!ai) {
    res.status(400).json({
      error: 'GEMINI_API_KEY is not configured.',
    });
    return;
  }

  const { completedTasks, pendingTasks, learnings, accomplishments, difficulties, tomorrowPriorities, energyRating } = req.body;

  const prompt = `You are the ProgressOS Personal Coach.
The user has completed their daily reflection:
- Energy/Satisfaction Score: ${energyRating}/5
- Completed Tasks: ${JSON.stringify(completedTasks || [])}
- Rollover / Remaining Tasks: ${JSON.stringify(pendingTasks || [])}
- What they learned today: "${learnings || 'None recorded'}"
- Key Accomplishments: "${accomplishments || 'None recorded'}"
- Difficulties / Roadblocks: "${difficulties || 'None recorded'}"
- Tomorrow's Stated Priorities: "${tomorrowPriorities || 'None recorded'}"

Provide a constructive, high-clarity daily debrief:
1. Acknowledge the day's wins realistically without hyperbole.
2. Unpack the reported difficulties and provide a rapid solution or mental framing.
3. Validate tomorrow's priorities and suggest how to sequence them for peak momentum.

Format as JSON:
{
  "debriefTitle": "A concise headline for the day (e.g. 'Solid Deep-Work Day with Minor Friction')",
  "coachReflection": "2-3 paragraphs of coaching insight and tactical encouragement",
  "tomorrowStrategy": "1 paragraph on the best tactical plan for tomorrow",
  "keyTakeaway": "One memorable power sentence"
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '{}';
    const parsed = cleanAndParseJson(text);
    res.json(parsed);
  } catch (error) {
    handleGeminiError(res, error, 'Failed to generate review summary');
  }
});

// 5. Ask Progress AI (Interactive Chat)
app.post('/api/gemini/chat', async (req: Request, res: Response) => {
  const ai = getGeminiClient();
  if (!ai) {
    res.status(400).json({
      error: 'GEMINI_API_KEY is not configured.',
    });
    return;
  }

  const { messages, context } = req.body;

  const systemInstruction = `You are "Progress AI", the intelligent personal life operating system analyst inside ProgressOS.
You have real-time visibility into the user's actual stored data:
- Categories: ${JSON.stringify(context?.categories || [])}
- Tasks Summary: ${JSON.stringify(context?.tasks || [])}
- Long-term Goals & Milestones: ${JSON.stringify(context?.goals || [])}
- Performance Stats: ${JSON.stringify(context?.stats || {})}

Guidelines:
1. Always reference the user's REAL data (specific task titles, category completion rates, goal milestones).
2. Clearly distinguish between RECORDED FACTS (actual tasks, hours, percentages) and RECOMMENDATIONS.
3. Be direct, structured, encouraging, and highly analytical.
4. When asked "Where am I improving?", highlight specific categories with high completion rates or streaks.
5. When asked "What should I prioritize tomorrow?", evaluate pending high/urgent priority tasks, approaching deadlines, and neglected goals.
6. When asked "Which goal needs more attention?", identify goals with low milestone progress or few recent tasks.
7. Use bullet points and bold highlights for readable, executive-style answers.`;

  try {
    // Format conversation history
    const contents = (messages || []).map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: contents,
      config: {
        systemInstruction,
      },
    });

    res.json({ reply: response.text || 'No response generated.' });
  } catch (error) {
    handleGeminiError(res, error, 'Failed to generate chat response');
  }
});

// Setup Vite middleware in dev or static files in prod
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ProgressOS server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
