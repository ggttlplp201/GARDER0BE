// Garderobe — ASCII Background (WebGL grass + sky field)
// Drop-in replacement. Same import/usage as before: <AsciiBackground />
import React, { useEffect, useRef } from 'react';

const CHARS = ' .:-=+*#%@|/\\';
const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FS = `precision highp float;
uniform vec2 uRes, uCell; uniform float uTime, uHor, uSway, uN, uScene, uFocusY; uniform sampler2D uAtlas, uPhoto; uniform vec2 uPhotoSize;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+1.),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
float fbm3(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vn(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
float rdg(float x,float seed){float s=0.,a=.5,f=1.;for(int i=0;i<6;i++){float n=vn(vec2(x*f,seed+float(i)*3.3));n=1.-abs(n*2.-1.);s+=a*n*n;f*=2.05;a*=.5;}return s;}
vec2 clouds(vec2 p,float k,float sx,float sy){vec2 q=vec2(p.x*sx-uTime*.012,p.y*sy/(.35+k));float c=fbm(q*1.6);float c2=fbm(q*1.6+vec2(.015,-.05));return vec2(c,clamp((c-c2)*5.+.8,.5,1.));}

vec3 grass(vec2 p,out float kind,out float wind){
  float asp=uRes.x/uRes.y;
  float hz=uHor+(fbm(vec2(p.x*1.1,3.1))-.5)*.09+(vn(vec2(p.x*9.,8.))-.5)*.01;
  wind=0.;
  if(p.y<hz){
    kind=0.;
    float k=p.y/hz;
    vec3 sky=mix(vec3(.16,.40,.80),vec3(.68,.85,1.),pow(k,1.5));
    vec2 c=clouds(p,k,1.3,2.6);
    float cov=smoothstep(.47,.7,c.x)*(.3+.7*smoothstep(0.,.6,k));
    return mix(sky,mix(vec3(.6,.66,.78),vec3(1.,.99,.96),c.y),cov);
  }
  kind=1.;
  float d=(p.y-hz)/(1.-hz);
  float z=1./(d+.07);
  float gx=(p.x-asp*.5)*z;
  float gate=smoothstep(.35,.75,vn(vec2(uTime*.18,4.2)));
  float gf=fbm3(vec2(gx*.07-uTime*.55,z*.05+uTime*.02));
  float gust=smoothstep(.5,.8,gf)*(.25+.75*gate);
  wind=uSway*(.12+gust*1.3);
  float band=fbm(vec2(gx*.22-uTime*.05,z*.45));
  float lit=smoothstep(.36,.68,band);
  float bf=mix(560.,70.,d);
  vec2 bp=vec2(p.x*bf+wind*6.,p.y*bf*.09);
  vec2 bp2=vec2(p.x*bf*2.4+wind*12.+3.,p.y*bf*.16);
  float blade=vn(bp)*.45+vn(bp*vec2(2.7,1.9)+5.)*.25+vn(bp2)*.3;
  float tip=smoothstep(.72,.9,vn(bp2*vec2(1.,.6)+9.));
  float shadow=smoothstep(.62,.25,fbm3(vec2(gx*.9,z*1.6)));
  float L=clamp(lit*.62+(blade-.5)*(.7+.5*d)+.08+gust*uSway*.45+tip*.18*(.4+lit)-shadow*.12,0.,1.);
  vec3 dark=vec3(.10,.24,.04),mid=vec3(.33,.60,.10),hi=vec3(.74,.9,.28),top=vec3(.96,1.,.62);
  vec3 col=L<.5?mix(dark,mid,L*2.):(L<.86?mix(mid,hi,(L-.5)/.36):mix(hi,top,(L-.86)/.14));
  col=mix(col,vec3(.42,.6,.56),(1.-smoothstep(0.,.1,d))*.55);
  return col*.8;
}

vec3 photo(vec2 sp, vec2 cell){
  float sa=uRes.x/uRes.y, ia=uPhotoSize.x/uPhotoSize.y;
  vec2 uv;
  if(sa>ia){float vh=ia/sa;uv=vec2(sp.x,clamp(uFocusY,vh*.5,1.-vh*.5)+(sp.y-.5)*vh);}
  else{float vw=sa/ia;uv=vec2(.5+(sp.x-.5)*vw,sp.y);}
  float t=uTime;
  if(uScene<1.5){
    if(uv.y>.24){float w=uv.y-.24;uv.x+=sin(uv.y*160.-t*1.4+sin(uv.x*9.)*2.)*.0016*(.3+w*2.);uv.y+=sin(uv.x*50.+t*.9)*.0009*(.3+w*2.);}
    else uv.x+=sin(t*.12)*.004*(1.-uv.y/.24);
  } else if(uScene>2.5){
    if(uv.y<.3) uv.x+=sin(t*.1)*.006*(1.-uv.y/.3);
    if(uv.y>.78) uv.x+=sin(uv.y*120.+t*1.1+uv.x*25.)*.0011*uSway*2.;
  }
  vec3 col=texture2D(uPhoto,clamp(uv,0.,1.)).rgb;
  float L=dot(col,vec3(.3,.59,.11));
  if(uScene<1.5) col*=1.+.22*(vn(cell*.35+vec2(t*1.6,t*.4))-.5)*smoothstep(.45,.8,L)*step(.24,uv.y);
  else if(uScene<2.5) col*=1.+.5*(vn(cell*.6+vec2(t*.9,-t*.5))-.5)*smoothstep(.25,.6,L);
  return col;
}

void main(){
  vec2 fc=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);
  vec2 cell=floor(fc/uCell), loc=fract(fc/uCell);
  vec2 c=(cell+.5)*uCell/uRes.y;
  float kind=2., wind=0.;
  vec3 col;
  if(uScene<.5) col=grass(c,kind,wind);
  else col=photo((cell+.5)*uCell/uRes,cell);
  float L=dot(col,vec3(.3,.59,.11));
  float gi=floor(clamp(L*1.15,0.,.999)*10.);
  if(kind>.5&&kind<1.5&&L>.28&&h21(cell)<.55) gi=10.+(wind<-.22?2.:(wind>.22?1.:0.));
  float m=texture2D(uAtlas,vec2((gi+loc.x)/uN,loc.y)).r;
  gl_FragColor=vec4(min(col*(uScene<.5?(.55+.7*m)*1.1:(.5+.75*m)),1.),1.);
}`;

export function AsciiBackground({ cellSize = 4, horizon = 0.42, sway = 0.9, fps = 30 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const gl = cv.getContext('webgl', { antialias: false });
    if (!gl) return;
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh)); return sh; };
    const pr = gl.createProgram();
    gl.attachShader(pr, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr); gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {}; ['uRes', 'uCell', 'uTime', 'uHor', 'uSway', 'uN', 'uAtlas', 'uScene'].forEach(n => u[n] = gl.getUniformLocation(pr, n));
    const tex = gl.createTexture();
    let cell = [3, 4];

    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
      const gh = Math.max(4, Math.round(cellSize * dpr)), gw = Math.max(3, Math.round(gh * 0.6));
      cell = [gw, gh];
      const a = document.createElement('canvas'); a.width = gw * CHARS.length; a.height = gh;
      const x = a.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, a.width, a.height);
      x.fillStyle = '#fff'; x.font = "500 " + gh + "px 'JetBrains Mono', monospace";
      x.textAlign = 'center'; x.textBaseline = 'middle';
      for (let i = 0; i < CHARS.length; i++) x.fillText(CHARS[i], i * gw + gw / 2, gh * 0.55);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.viewport(0, 0, cv.width, cv.height);
    };

    let raf = 0, last = 0, dead = false;
    const start = performance.now(), interval = 1000 / fps;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (now - last < interval) return;
      last = now;
      gl.uniform2f(u.uRes, cv.width, cv.height);
      gl.uniform2f(u.uCell, cell[0], cell[1]);
      gl.uniform1f(u.uTime, (now - start) / 1000);
      gl.uniform1f(u.uHor, horizon);
      gl.uniform1f(u.uSway, sway);
      gl.uniform1f(u.uN, CHARS.length);
      gl.uniform1f(u.uScene, 0);
      gl.uniform1i(u.uAtlas, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
      if (dead) return;
      measure();
      raf = requestAnimationFrame(tick);
    });
    const ro = new ResizeObserver(() => measure());
    ro.observe(cv);
    return () => { dead = true; cancelAnimationFrame(raf); ro.disconnect(); };
  }, [cellSize, horizon, sway, fps]);

  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none', zIndex: 0 }}
    />
  );
}

export default AsciiBackground;
