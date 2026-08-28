# MiniMax H3 Prompt Writing

Use this Skill when preparing prompts for the `minimax-h3` Tool.

Write the prompt as a concrete audiovisual specification rather than a loose idea. State subjects, setting, composition, camera movement, actions, timing, lighting, and continuity explicitly. For multi-shot sequences, identify shot boundaries and important timestamps. Describe dialogue, diegetic sound, ambience, and non-diegetic music separately when they matter.

For FL2VA and Ref2VA, treat supplied images, video, and audio as authoritative references. Do not contradict identity, layout, style, or temporal constraints established by those references. Use `conditions` to carry reference media and roles; keep the text focused on the intended result and relationships among those inputs.

For difficult requests, first produce a precise generation prompt, then submit it. Use `generate` to obtain a job id, `status` to inspect progress, and `download` only after the job is complete.
