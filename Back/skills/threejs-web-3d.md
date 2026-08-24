---
name: threejs-web-3d
description: Create real-time 3D animation for the web using Three.js (WebGL). Use for interactive scenes, product showcases, data visualizations, and animated backgrounds.
---

# Three.js Web 3D

Build real-time 3D experiences in the browser with Three.js.

## Setup

- Use a module import: `import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';` or a local bundler.
- Standard scene scaffold: scene, camera, renderer, loop.

## Conventions

- Use a `requestAnimationFrame` render loop with clock-based delta time.
- Respect performance: limit draw calls, use `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`.
- Respect `prefers-reduced-motion` where possible.
- Keep geometry and material choices purposeful for the intended interaction.

## Typical Structure

```html
<canvas id="c"></canvas>
<script type="module">
  import * as THREE from '.../three.module.js';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') });
  // add meshes, lights, controls, animate
</script>
```

## Quality

- Use OrbitControls for exploratory scenes, small utility functions for rotation/tweening.
- Profile for 60fps on target devices.
- Export final artifact as a self-contained HTML page where appropriate.
.