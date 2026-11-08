'use client';

// A slow liquid-metal shader, so feature cards need no stock images.
import { useEffect, useRef } from 'react';

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec3 c;uniform float s;
float n(vec2 p){return sin(p.x)*cos(p.y);}
float f(vec2 p){float a=.5,v=0.;mat2 m=mat2(.8,.6,-.6,.8);for(int i=0;i<3;i++){v+=a*n(p);p=m*p*2.02+vec2(s);a*=.5;}return v;}
void main(){vec2 u=gl_FragCoord.xy/r;u.x*=r.x/r.y;vec2 p=u*2.4+vec2(s);
float w=f(p+vec2(f(p+t*.06),f(p-t*.05)));
float l=abs(sin(w*3.5+u.y*2.));l=pow(1.-l,3.);
float g=smoothstep(-.5,.9,w);
vec3 col=c*(l*.8+g*.22)+vec3(1.)*pow(l,8.)*.45;
col*=smoothstep(0.,.55,u.y);
gl_FragColor=vec4(col,1.);}`;

export function LiquidCard({ tint, seed, className }: { tint: [number, number, number]; seed: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext('webgl', { antialias: false, powerPreference: 'low-power' });
    if (!canvas || !gl) return;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.bindAttribLocation(prog, 0, 'p');
    gl.vertexAttribPointer(gl.getAttribLocation(prog, 'p'), 2, gl.FLOAT, false, 0, 0);
    gl.uniform3f(gl.getUniformLocation(prog, 'c'), ...tint);
    gl.uniform1f(gl.getUniformLocation(prog, 's'), seed);
    const uT = gl.getUniformLocation(prog, 't');
    const uR = gl.getUniformLocation(prog, 'r');

    const draw = (time: number) => {
      gl.uniform1f(uT, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const size = () => {
      canvas.width = Math.floor(canvas.clientWidth / 1.5) || 1;
      canvas.height = Math.floor(canvas.clientHeight / 1.5) || 1;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uR, canvas.width, canvas.height);
      draw(seed * 10);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const loop = (now: number) => {
      draw(now / 1000 + seed * 10);
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf);
      if (e.isIntersecting && !still) raf = requestAnimationFrame(loop);
    });
    io.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [tint, seed]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
