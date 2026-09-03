/**
 * Motor autoral da aurora da suíte Mentor.
 *
 * Ele preserva o mecanismo aprovado no laboratório: um único canvas WebGL,
 * relógio acumulado, limite de 30 fps e grade estática como fallback visual.
 * Não usa textura, imagem, dependência nova ou animação escondida em CSS.
 */

export type AuroraModule = "mentor" | "hub" | "obstetricia";
export type AuroraTheme = "light" | "dark";

export type AuroraStatus = {
  ready: boolean;
  renderer: string;
  error?: string;
};

export type AuroraStats = {
  frames: number;
  elapsed: number;
  active: boolean;
  paused: boolean;
  renderer: string;
};

export type AuroraController = {
  setActive(active: boolean): void;
  setPaused(paused: boolean): void;
  setPalette(module: AuroraModule, theme: AuroraTheme): void;
  getStats(): AuroraStats;
  dispose(): void;
};

type Palette = {
  primary: readonly [number, number, number];
  secondary: readonly [number, number, number];
  highlight: readonly [number, number, number];
};

type Uniforms = {
  resolution: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  primary: WebGLUniformLocation | null;
  secondary: WebGLUniformLocation | null;
  highlight: WebGLUniformLocation | null;
};

const RENDERER = "WebGL 1 · aurora autoral";

// Cada módulo conserva a mesma cortina contínua; só muda sua identidade cromática.
const PALETTES: Record<AuroraModule, Record<AuroraTheme, Palette>> = {
  mentor: {
    dark: {
      primary: [0.525, 0.075, 0.208],
      secondary: [0.835, 0.145, 0.314],
      highlight: [0.929, 0.251, 0.373],
    },
    light: {
      primary: [0.565, 0.11, 0.24],
      secondary: [0.765, 0.18, 0.34],
      highlight: [0.89, 0.31, 0.42],
    },
  },
  hub: {
    dark: {
      primary: [0.035, 0.31, 0.33],
      secondary: [0.055, 0.57, 0.58],
      highlight: [0.18, 0.77, 0.73],
    },
    light: {
      primary: [0.04, 0.37, 0.39],
      secondary: [0.06, 0.62, 0.61],
      highlight: [0.21, 0.78, 0.73],
    },
  },
  obstetricia: {
    dark: {
      primary: [0.055, 0.36, 0.19],
      secondary: [0.09, 0.67, 0.36],
      highlight: [0.29, 0.84, 0.52],
    },
    light: {
      primary: [0.07, 0.42, 0.23],
      secondary: [0.1, 0.7, 0.39],
      highlight: [0.32, 0.86, 0.55],
    },
  },
};

// Um único triângulo cobre toda a tela e elimina costuras de duas metades.
const VERTEX_SOURCE = `
  attribute vec2 a_position;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

// A aurora é uma dobra contínua: ela muda de forma, não apenas de posição.
const fragmentSource = (precision: "highp" | "mediump") => `
  precision ${precision} float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec3 u_primary;
  uniform vec3 u_secondary;
  uniform vec3 u_highlight;

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float aspect = clamp(u_resolution.x / u_resolution.y, 0.65, 1.9);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = u_time * 0.26;

    float travel = 0.32 * sin(t * 0.73) + 0.16 * sin(t * 0.37 + 1.9);
    float bend = 0.29 * sin(p.y * 4.6 + t * 0.89)
               + 0.12 * sin(p.y * 8.3 - t * 0.61 + 0.7);
    float drift = p.x + bend - travel;
    float lift = p.y + 0.14 * sin(p.x * 3.8 - t * 0.67)
                     + 0.07 * sin(drift * 6.4 + t * 0.51);

    float fold = drift + 0.17 * sin(lift * 5.9 + t * 1.07)
                       + 0.055 * sin(lift * 12.1 - t * 0.83);
    float sheet = exp(-fold * fold * 4.3);
    float silk = 0.5 + 0.5 * sin(fold * 10.8 + lift * 2.1 + t * 0.72);
    silk = silk * silk;

    float lipPosition = fold - 0.17 * sin(lift * 3.7 - t * 0.59) - 0.12;
    float lip = exp(-lipPosition * lipPosition * 52.0);
    float undertone = exp(-(fold + 0.34) * (fold + 0.34) * 10.0);
    float ribbons = 0.76 + 0.24 * sin(lift * 7.4 + fold * 3.1 - t * 0.94);
    float wideLight = sheet * (0.20 + 0.30 * silk) * ribbons;
    float edgeLight = lip * (0.17 + 0.14 * silk);

    vec3 light = u_primary * wideLight
               + u_secondary * edgeLight
               + u_highlight * lip * silk * 0.08
               + u_primary * undertone * 0.095;

    float atmosphere = 0.014 + 0.010 * (0.5 + 0.5 * sin(lift * 2.8 - t * 0.45));
    light += u_primary * atmosphere;

    float vignette = 0.76 + 0.24 * (1.0 - smoothstep(0.25, 0.82, length(uv - 0.5)));
    light *= vignette;

    vec3 premultiplied = clamp(light * 0.88, 0.0, 0.68);
    float alpha = max(premultiplied.r, max(premultiplied.g, premultiplied.b));
    gl_FragColor = vec4(premultiplied, alpha);
  }
`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Cria o único canvas da tela. O controlador é deliberadamente pequeno para
 * tornar impossível iniciar um segundo relógio por acidente no React.
 */
export function createSuiteAurora(
  canvas: HTMLCanvasElement,
  onStatus: (status: AuroraStatus) => void = () => undefined,
  initial: { module: AuroraModule; theme: AuroraTheme } = { module: "mentor", theme: "dark" },
): AuroraController {
  const documentRef = canvas.ownerDocument;
  const view = documentRef.defaultView;
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let vertexBuffer: WebGLBuffer | null = null;
  let uniforms: Uniforms | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let animationFrame: number | null = null;
  let previousTimestamp: number | null = null;
  let previousPaint: number | null = null;
  let elapsed = 0;
  let frames = 0;
  let active = true;
  let paused = false;
  let disposed = false;
  let ready = false;
  let contextLost = false;
  let palette = PALETTES[initial.module][initial.theme];

  const report = (nextReady: boolean, error?: string) => {
    onStatus({ ready: nextReady, renderer: RENDERER, error });
  };

  const getContext = (): WebGLRenderingContext => {
    if (!gl) throw new Error("A tela gráfica da aurora não está disponível.");
    return gl;
  };

  // Pausar nunca zera elapsed: retomar continua do instante em que a luz parou.
  const stopLoop = () => {
    if (animationFrame !== null && view) view.cancelAnimationFrame(animationFrame);
    animationFrame = null;
    previousTimestamp = null;
    previousPaint = null;
  };

  const running = () =>
    ready && active && !paused && !documentRef.hidden && !disposed && !contextLost;

  const releaseResources = () => {
    if (!gl || contextLost) return;
    if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
    if (program) gl.deleteProgram(program);
    vertexBuffer = null;
    program = null;
    uniforms = null;
  };

  const fail = (error: unknown) => {
    ready = false;
    stopLoop();
    releaseResources();
    report(false, errorMessage(error));
  };

  const compile = (type: number, source: string): WebGLShader => {
    const context = getContext();
    const shader = context.createShader(type);
    if (!shader) throw new Error("O navegador não conseguiu criar o programa da aurora.");
    context.shaderSource(shader, source);
    context.compileShader(shader);

    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
      const details = context.getShaderInfoLog(shader) || "Falha sem diagnóstico do driver.";
      context.deleteShader(shader);
      throw new Error(`A aurora não pôde ser compilada: ${details}`);
    }

    return shader;
  };

  const prepareProgram = () => {
    const context = getContext();
    const precision = context.getShaderPrecisionFormat(context.FRAGMENT_SHADER, context.HIGH_FLOAT);
    const fragmentPrecision = precision?.precision ? "highp" : "mediump";
    const shaders: WebGLShader[] = [];
    let nextProgram: WebGLProgram | null = null;
    let nextBuffer: WebGLBuffer | null = null;

    try {
      shaders.push(compile(context.VERTEX_SHADER, VERTEX_SOURCE));
      shaders.push(compile(context.FRAGMENT_SHADER, fragmentSource(fragmentPrecision)));

      nextProgram = context.createProgram();
      if (!nextProgram) throw new Error("Programa gráfico indisponível.");
      for (const shader of shaders) context.attachShader(nextProgram, shader);
      context.linkProgram(nextProgram);

      if (!context.getProgramParameter(nextProgram, context.LINK_STATUS)) {
        throw new Error(`A aurora não pôde iniciar: ${context.getProgramInfoLog(nextProgram)}`);
      }

      nextBuffer = context.createBuffer();
      if (!nextBuffer) throw new Error("Memória gráfica indisponível.");

      context.useProgram(nextProgram);
      context.bindBuffer(context.ARRAY_BUFFER, nextBuffer);
      context.bufferData(
        context.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        context.STATIC_DRAW,
      );

      const position = context.getAttribLocation(nextProgram, "a_position");
      if (position < 0) throw new Error("A posição da aurora não foi localizada.");
      context.enableVertexAttribArray(position);
      context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);

      const nextUniforms: Uniforms = {
        resolution: context.getUniformLocation(nextProgram, "u_resolution"),
        time: context.getUniformLocation(nextProgram, "u_time"),
        primary: context.getUniformLocation(nextProgram, "u_primary"),
        secondary: context.getUniformLocation(nextProgram, "u_secondary"),
        highlight: context.getUniformLocation(nextProgram, "u_highlight"),
      };

      context.disable(context.DEPTH_TEST);
      context.disable(context.BLEND);
      context.clearColor(0, 0, 0, 0);
      // Transfere a posse só depois da preparação inteira; falhas anteriores limpam os locais.
      program = nextProgram;
      vertexBuffer = nextBuffer;
      uniforms = nextUniforms;
      nextProgram = null;
      nextBuffer = null;
      ready = true;
    } finally {
      shaders.forEach((shader) => context.deleteShader(shader));
      if (nextBuffer) context.deleteBuffer(nextBuffer);
      if (nextProgram) context.deleteProgram(nextProgram);
    }
  };

  const draw = () => {
    if (!ready || disposed || contextLost) return;
    const context = gl;

    if (!context) return;
    if (!active) {
      context.clear(context.COLOR_BUFFER_BIT);
      return;
    }
    if (!program || !vertexBuffer || !uniforms) return;

    context.useProgram(program);
    context.bindBuffer(context.ARRAY_BUFFER, vertexBuffer);
    context.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    context.uniform1f(uniforms.time, elapsed);
    context.uniform3f(uniforms.primary, ...palette.primary);
    context.uniform3f(uniforms.secondary, ...palette.secondary);
    context.uniform3f(uniforms.highlight, ...palette.highlight);
    context.drawArrays(context.TRIANGLES, 0, 3);
    frames += 1;
  };

  const resize = () => {
    if (!ready || disposed || !view) return;
    const context = gl;
    if (!context) return;

    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width || view.innerWidth);
    const height = Math.max(1, bounds.height || view.innerHeight);

    // O limite preserva fluidez móvel perceptível sem renderizar pixels inúteis.
    const pixelBudget = width < 820 ? 620_000 : 1_450_000;
    const density = Math.min(
      view.devicePixelRatio || 1,
      1.5,
      Math.sqrt(pixelBudget / (width * height)),
    );
    const nextWidth = Math.max(1, Math.round(width * density));
    const nextHeight = Math.max(1, Math.round(height * density));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    context.viewport(0, 0, canvas.width, canvas.height);
    draw();
  };

  const tick = (timestamp: number) => {
    animationFrame = null;
    if (!running() || !view) return;

    if (previousTimestamp !== null) {
      // Uma suspensão longa não vira salto visual quando a página retorna.
      elapsed += Math.min(Math.max(0, timestamp - previousTimestamp) / 1_000, 0.08);
    }
    previousTimestamp = timestamp;

    // O laboratório aprovado calibrou 30 fps: suave, mas ainda legível no celular.
    if (previousPaint === null || timestamp - previousPaint >= 1_000 / 30 - 0.5) {
      draw();
      previousPaint = timestamp;
    }

    animationFrame = view.requestAnimationFrame(tick);
  };

  const startLoop = () => {
    if (running() && animationFrame === null && view) {
      animationFrame = view.requestAnimationFrame(tick);
    }
  };

  const visibilityChanged = () => {
    stopLoop();
    if (!documentRef.hidden) {
      resize();
      startLoop();
    }
  };

  const loseContext = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    ready = false;
    stopLoop();
    report(false, "A aurora perdeu o contexto gráfico.");
  };

  const restoreContext = () => {
    if (disposed) return;
    contextLost = false;
    program = null;
    vertexBuffer = null;
    uniforms = null;

    try {
      prepareProgram();
      resize();
      startLoop();
      report(true);
    } catch (error) {
      fail(error);
    }
  };

  const controller: AuroraController = {
    setActive(nextActive) {
      if (disposed || active === Boolean(nextActive)) return;
      active = Boolean(nextActive);
      stopLoop();

      if (active) {
        resize();
        startLoop();
      } else {
        draw();
      }
    },

    setPaused(nextPaused) {
      if (disposed || paused === Boolean(nextPaused)) return;
      paused = Boolean(nextPaused);
      stopLoop();
      startLoop();
    },

    setPalette(module, theme) {
      palette = PALETTES[module][theme];
      draw();
    },

    getStats() {
      return {
        frames,
        elapsed,
        active,
        paused: paused || documentRef.hidden,
        renderer: RENDERER,
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      ready = false;
      stopLoop();
      resizeObserver?.disconnect();
      view?.removeEventListener("resize", resize);
      documentRef.removeEventListener("visibilitychange", visibilityChanged);
      canvas.removeEventListener("webglcontextlost", loseContext);
      canvas.removeEventListener("webglcontextrestored", restoreContext);
      if (gl && !contextLost) gl.clear(gl.COLOR_BUFFER_BIT);
      releaseResources();
    },
  };

  if (!view || !canvas.getContext) {
    report(false, "A tela gráfica da aurora não está disponível.");
    return controller;
  }

  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("WebGL não está disponível neste navegador.");

    prepareProgram();
    resize();

    if (view.ResizeObserver) {
      resizeObserver = new view.ResizeObserver(resize);
      resizeObserver.observe(canvas);
    }

    view.addEventListener("resize", resize, { passive: true });
    documentRef.addEventListener("visibilitychange", visibilityChanged);
    canvas.addEventListener("webglcontextlost", loseContext);
    canvas.addEventListener("webglcontextrestored", restoreContext);
    startLoop();
    report(true);
  } catch (error) {
    fail(error);
  }

  return controller;
}
