const tool = {
  name: "alarm-trigger",
  description: "Triggers an alarm notification by emitting a terminal bell and logging an urgent alarm message.",
  input: {
    type: "object",
    properties: {
      message: { type: "string", description: "Custom alarm message to display" },
      repeat: { type: "number", description: "Number of times to ring the bell", default: 3 },
    },
    required: [],
  },
  async execute(inputs = {}) {
    const message = inputs.message ? String(inputs.message) : "ALARM! It is 5:00 AM - Time to wake up!";
    const repeat = typeof inputs.repeat === "number" ? inputs.repeat : 3;
    const now = new Date().toISOString();
    console.log(`[ALARM ${now}] ${message}`);
    process.stdout.write("\x07".repeat(Math.max(1, Math.floor(repeat))));
    return { triggered: true, timestamp: now, message };
  },
};

export default tool;
