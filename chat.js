export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message, context } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const systemPrompt = `You are ARIA — AI Resource Intelligence Advisor embedded in NimbusIQ cloud cost platform.
Expert in AWS/GCP/Azure, FinOps, cloud architecture, sustainability.
Be concise, specific, data-driven. Use **bold** for key numbers. Bullet points for lists.
Always end with ONE concrete next step. Never say you lack access — use the context.
Context: ${context || "No data uploaded yet."}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        max_tokens: 1000
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Error calling OpenAI API" });
    }

    return res.status(200).json({ reply: data.choices[0].message.content });
  } catch (error) {
    console.error("AI Chat Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
