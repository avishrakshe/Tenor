'use client';

// The 3D pieces: a chrome TENOR wordmark and the ring-and-T monogram. Letters are drawn here as
// shapes, so the logotype belongs to Tenor. three.js loads only when a scene mounts.
import { useEffect, useRef, useState } from 'react';
import type { MotionValue } from 'motion/react';
import type * as ThreeNS from 'three';

type Three = typeof ThreeNS;

function letterShape(T: Three, ch: string) {
  const s = new T.Shape();
  const poly = (pts: number[][]) => {
    s.moveTo(pts[0][0], pts[0][1]);
    pts.slice(1).forEach(([x, y]) => s.lineTo(x, y));
    s.closePath();
  };
  if (ch === 'T') poly([[0, 1], [0.8, 1], [0.8, 0.8], [0.5, 0.8], [0.5, 0], [0.3, 0], [0.3, 0.8], [0, 0.8]]);
  if (ch === 'E') poly([[0, 0], [0.66, 0], [0.66, 0.19], [0.2, 0.19], [0.2, 0.41], [0.58, 0.41], [0.58, 0.59], [0.2, 0.59], [0.2, 0.81], [0.66, 0.81], [0.66, 1], [0, 1]]);
  if (ch === 'N') poly([[0, 0], [0.2, 0], [0.2, 0.66], [0.62, 0], [0.82, 0], [0.82, 1], [0.62, 1], [0.62, 0.34], [0.2, 1], [0, 1]]);
  if (ch === 'O') {
    s.absellipse(0.5, 0.5, 0.5, 0.52, 0, Math.PI * 2, false, 0);
    const h = new T.Path();
    h.absellipse(0.5, 0.5, 0.3, 0.32, 0, Math.PI * 2, true, 0);
    s.holes.push(h);
  }
  if (ch === 'R') {
    s.moveTo(0, 0);
    s.lineTo(0.2, 0);
    s.lineTo(0.2, 0.38);
    s.lineTo(0.34, 0.38);
    s.lineTo(0.5, 0);
    s.lineTo(0.72, 0);
    s.lineTo(0.53, 0.42);
    s.quadraticCurveTo(0.7, 0.5, 0.7, 0.69);
    s.quadraticCurveTo(0.7, 1, 0.38, 1);
    s.lineTo(0, 1);
    s.closePath();
    const h = new T.Path();
    h.moveTo(0.2, 0.55);
    h.lineTo(0.38, 0.55);
    h.quadraticCurveTo(0.5, 0.55, 0.5, 0.69);
    h.quadraticCurveTo(0.5, 0.83, 0.38, 0.83);
    h.lineTo(0.2, 0.83);
    h.closePath();
    s.holes.push(h);
  }
  return s;
}

function extrude(T: Three, shape: ThreeNS.Shape, depth = 0.16) {
  const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 48 });
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
  return g;
}

/** A dark studio with bright strips, which is what makes metal read as chrome. */
function studioEnv(T: Three, renderer: ThreeNS.WebGLRenderer) {
  const scene = new T.Scene();
  scene.background = new T.Color(0x050505);
  const strip = (w: number, h: number, x: number, y: number, z: number, v: number) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(v, v, v), side: T.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  strip(14, 3, 0, 8, 3, 9);
  strip(2, 12, -9, 1, 3, 6);
  strip(2, 12, 9, 2, 2, 5);
  strip(10, 1, 0, -6, 6, 1.4);
  // Flat letter faces mirror whatever is behind the camera, so that has to be bright.
  strip(30, 30, 0, 0, 14, 2.4);
  const pmrem = new T.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  return env;
}

function xray(T: Three, g: ThreeNS.BufferGeometry, group: ThreeNS.Object3D, env: ThreeNS.Texture) {
  group.add(
    new T.Mesh(g, new T.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, envMap: env, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide })),
  );
  group.add(new T.LineSegments(new T.EdgesGeometry(g, 24), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })));
}

type Frame = (t: number, dt: number) => void;
type Build = (T: Three, ctx: { scene: ThreeNS.Scene; camera: ThreeNS.PerspectiveCamera; renderer: ThreeNS.WebGLRenderer }) => { frame: Frame; resize?: (aspect: number) => void };

function useScene(build: Build) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let stop = () => {};
    let cancelled = false;
    (async () => {
      const T = await import('three');
      if (cancelled) return;
      let renderer: ThreeNS.WebGLRenderer;
      try {
        renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        setFailed(true);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = T.ACESFilmicToneMapping;
      host.appendChild(renderer.domElement);
      renderer.domElement.style.display = 'block';
      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(28, 1, 0.1, 100);
      const { frame, resize } = build(T, { scene, camera, renderer });

      const fit = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        resize?.(w / h);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(host);

      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let raf = 0;
      let last = performance.now();
      const loop = (now: number) => {
        frame(now / 1000, Math.min((now - last) / 1000, 0.05));
        last = now;
        renderer.render(scene, camera);
        raf = requestAnimationFrame(loop);
      };
      // Only spends GPU time while on screen.
      const io = new IntersectionObserver(([e]) => {
        cancelAnimationFrame(raf);
        if (e.isIntersecting && !still) {
          last = performance.now();
          raf = requestAnimationFrame(loop);
        }
      });
      io.observe(host);
      if (still) {
        frame(1000, 0);
        renderer.render(scene, camera);
      }
      stop = () => {
        cancelAnimationFrame(raf);
        io.disconnect();
        ro.disconnect();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, failed };
}

export function Wordmark({ className }: { className?: string }) {
  const { ref, failed } = useScene((T, { scene, camera, renderer }) => {
    const env = studioEnv(T, renderer);
    const chrome = new T.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.22, envMap: env, envMapIntensity: 1.25, vertexColors: true });
    const word = 'TENOR';
    const widths: Record<string, number> = { T: 0.8, E: 0.66, N: 0.82, O: 1, R: 0.72 };
    const gap = 0.2;
    const total = [...word].reduce((a, c) => a + widths[c], 0) + gap * (word.length - 1);
    const group = new T.Group();
    scene.add(group);
    const letters: ThreeNS.Group[] = [];
    let x = -total / 2;
    for (const c of word) {
      const g = extrude(T, letterShape(T, c));
      const holder = new T.Group();
      // Brushed-steel fall-off from the top of each letter to the bottom.
      const pos = g.attributes.position;
      const shade = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i += 1) {
        const v = 0.42 + (pos.getY(i) + 0.5) * 0.58;
        shade.set([v, v, v], i * 3);
      }
      g.setAttribute('color', new T.BufferAttribute(shade, 3));
      if (c === 'O') xray(T, g, holder, env);
      else holder.add(new T.Mesh(g, chrome));
      holder.position.x = x + widths[c] / 2;
      x += widths[c] + gap;
      group.add(holder);
      letters.push(holder);
    }
    const ring = letters[word.indexOf('O')];
    let mx = 0;
    let my = 0;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    let born: number | null = null;
    return {
      resize: (aspect) => {
        const fov = (camera.fov * Math.PI) / 180;
        camera.position.z = Math.max((total * 0.56) / (Math.tan(fov / 2) * aspect), 1.2 / Math.tan(fov / 2));
      },
      frame: (t) => {
        // Wall-clock time, so the intro lands on schedule even at a low frame rate.
        born ??= t;
        const age = t - born;
        letters.forEach((l, i) => {
          const k = Math.min(Math.max((age - i * 0.09) / 1.1, 0), 1);
          const e = 1 - (1 - k) ** 3;
          l.position.y = (1 - e) * -0.9;
          if (l !== ring) l.rotation.x = (1 - e) * 1.1;
        });
        ring.rotation.y = t * 0.8;
        group.rotation.y += (mx * 0.28 - group.rotation.y) * 0.05;
        group.rotation.x += (my * 0.14 - group.rotation.x) * 0.05;
      },
    };
  });
  if (failed) return <div className={`chrome-text flex items-center justify-center text-[18vw] font-semibold ${className}`}>TENOR</div>;
  return <div ref={ref} className={className} aria-hidden="true" />;
}

/** The ring-and-T monogram. Turns with `progress` as the page scrolls. */
export function Mark({ progress, className }: { progress?: MotionValue<number>; className?: string }) {
  const { ref, failed } = useScene((T, { scene, camera, renderer }) => {
    const env = studioEnv(T, renderer);
    const group = new T.Group();
    scene.add(group);
    xray(T, extrude(T, letterShape(T, 'O'), 0.22), group, env);
    const t = new T.Mesh(
      extrude(T, letterShape(T, 'T'), 0.1),
      new T.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.18, envMap: env, envMapIntensity: 1.3 }),
    );
    t.scale.setScalar(0.5);
    group.add(t);
    camera.position.z = 3.6;
    let spin = 0;
    return {
      frame: (_t, dt) => {
        spin += dt * 0.25;
        group.rotation.y = (progress?.get() ?? 0) * Math.PI * 4 + spin;
        group.rotation.x = Math.sin(spin * 0.8) * 0.12;
      },
    };
  });
  if (failed) return <div className={className} />;
  return <div ref={ref} className={className} aria-hidden="true" />;
}
