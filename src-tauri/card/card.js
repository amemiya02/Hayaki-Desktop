// Copyright: Hayaki contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// The card page. It runs at the media origin, so Card Content (including the
// scripts a Card Template carries) never shares an origin with Hayaki's
// interface or reaches the core. It talks to the interface only through
// postMessage with its parent window.
"use strict";

(function () {
  const parentWindow = window.parent;
  let mathjaxLoading = null;
  let queue = Promise.resolve();
  let typeans = null;

  function post(message) {
    parentWindow.postMessage({ source: "hayaki-card", ...message }, "*");
  }

  // Template scripts written for desktop Anki and AnkiDroid call these.
  function bridgeCommand(cmd) {
    post({ type: "cmd", cmd: String(cmd) });
  }
  window.pycmd = bridgeCommand;
  window.bridgeCommand = bridgeCommand;
  window.anki = window.anki || {};
  window.ankiPlatform = "desktop";
  window.onUpdateHook = [];
  window.onShownHook = [];

  const mathjaxPattern = /\\\[(.*?)\\\]|\\\((.*?)\\\)/su;

  function loadMathJax() {
    if (mathjaxLoading) return mathjaxLoading;
    window.MathJax = {
      tex: {
        displayMath: [["\\[", "\\]"]],
        processEscapes: false,
        processEnvironments: false,
        processRefs: false,
        packages: { "[+]": ["noerrors", "mathtools", "mhchem"], "[-]": ["textmacros"] },
      },
      loader: {
        load: ["[tex]/noerrors", "[tex]/mathtools", "[tex]/mhchem"],
        paths: { mathjax: "/_hayaki/mathjax" },
      },
      chtml: { fontURL: "/_hayaki/mathjax/output/chtml/fonts/woff-v2" },
      startup: { typeset: false },
    };
    mathjaxLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/_hayaki/mathjax/tex-chtml-full.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load MathJax"));
      document.head.appendChild(script);
    });
    return mathjaxLoading;
  }

  // Setting innerHTML does not run scripts, so each one is replaced by a copy.
  function replaceScript(old) {
    return new Promise((resolve) => {
      const script = document.createElement("script");
      for (const attribute of old.attributes) {
        script.setAttribute(attribute.name, attribute.value);
      }
      if (old.src) {
        script.addEventListener("load", () => resolve());
        script.addEventListener("error", () => resolve());
      }
      script.appendChild(document.createTextNode(old.innerHTML));
      old.replaceWith(script);
      if (!old.src) resolve();
    });
  }

  async function setInnerHTML(element, html) {
    for (const video of element.getElementsByTagName("video")) {
      video.pause();
      while (video.firstChild) video.removeChild(video.firstChild);
      video.load();
    }
    element.innerHTML = html;
    for (const script of [...element.getElementsByTagName("script")]) {
      await replaceScript(script);
    }
  }

  function imagesLoaded() {
    return Promise.all(
      [...document.images]
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            }),
        ),
    );
  }

  async function runHooks(hooks) {
    await Promise.allSettled(
      hooks.map((hook) => {
        try {
          return hook();
        } catch (error) {
          console.log("Hook failed: ", error);
          return undefined;
        }
      }),
    );
  }

  function applyFrame(frame) {
    const root = document.documentElement;
    root.classList.toggle("dark", !!frame.dark);
    root.classList.toggle("hayaki-canvas", true);
    root.dir = frame.dir || "ltr";
    if (frame.lang) root.lang = frame.lang;
    for (const [name, value] of Object.entries(frame.vars || {})) {
      root.style.setProperty(name, value);
    }
  }

  async function render(message) {
    const qa = document.getElementById("qa");
    applyFrame(message.frame || {});
    document.getElementById("card-css").textContent = message.css || "";
    const hasMath = mathjaxPattern.test(message.html);
    if (hasMath) {
      try {
        await loadMathJax();
      } catch (error) {
        console.error(error);
      }
    }
    qa.style.opacity = "0";
    window.onUpdateHook = [];
    window.onShownHook = [];
    try {
      await setInnerHTML(qa, message.html);
    } catch (error) {
      await setInnerHTML(qa, `<div>Invalid HTML on card: ${String(error)}</div>`);
    }
    document.body.className = message.bodyClass || "card";
    if (message.side === "question") window.scrollTo(0, 0);
    await runHooks(window.onUpdateHook);

    if (hasMath && window.MathJax && window.MathJax.startup) {
      try {
        await window.MathJax.startup.promise;
        window.MathJax.typesetClear();
        await window.MathJax.typesetPromise([qa]);
      } catch (error) {
        console.error(error);
      }
    }
    qa.style.opacity = "1";

    typeans = document.getElementById("typeans");
    if (typeans && message.side === "question" && message.focus !== false) typeans.focus();
    if (message.side === "answer") {
      imagesLoaded().then(() => {
        const answer = document.getElementById("answer");
        if (answer && message.scrollToAnswer !== false) answer.scrollIntoView({ block: "start" });
      });
    }
    if (!mathjaxLoading && message.preloadMath) loadMathJax();
    await runHooks(window.onShownHook);
    post({ type: "shown", side: message.side, token: message.token });
  }

  function drawFlag(flag) {
    const el = document.getElementById("_flag");
    el.hidden = !flag;
    el.style.color = `var(--flag-${flag})`;
  }

  function drawMark(marked) {
    document.getElementById("_mark").hidden = !marked;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== parentWindow) return;
    const message = event.data;
    if (!message || message.target !== "hayaki-card") return;
    switch (message.type) {
      case "render":
        queue = queue.then(() => render(message));
        break;
      case "flag":
        drawFlag(message.flag);
        break;
      case "mark":
        drawMark(message.marked);
        break;
      case "typed":
        post({ type: "typed", id: message.id, value: typeans ? typeans.value : null });
        break;
      case "scroll":
        window.scrollBy({ top: message.delta, behavior: "smooth" });
        break;
      case "eval":
        // Not supported: the interface never sends code to the card.
        break;
    }
  });

  // Keys pressed while the card has focus go to the interface's shortcuts,
  // except typing inside a field the template provides.
  document.addEventListener(
    "keydown",
    (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (typing) {
        if (event.key === "Enter" && target.id === "typeans") {
          event.preventDefault();
          bridgeCommand("ans");
        }
        return;
      }
      post({
        type: "key",
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        repeat: event.repeat,
      });
      if ([" ", "Enter"].includes(event.key) || /^[1-4]$/.test(event.key)) event.preventDefault();
      // The web view's own reload and navigation keys never act on the card page.
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === "F5" || (mod && /^[rpu]$/i.test(event.key)) || (event.altKey && /^Arrow(Left|Right)$/.test(event.key))) event.preventDefault();
    },
    true,
  );

  // Clicks on play buttons and links.
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link) return;
    const play = link.getAttribute("data-play");
    if (play) {
      event.preventDefault();
      bridgeCommand(`play:${play}`);
      return;
    }
    const href = link.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      post({ type: "open", url: href });
    }
  });

  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());

  window.addEventListener("DOMContentLoaded", () => post({ type: "ready" }));
})();

// Image Occlusion review, ported from upstream's ts/routes/image-occlusion/review.ts
// (with shapes/ and canvas-scale.ts). The stock Image Occlusion Note Type's
// templates call `anki.imageOcclusion.setup()`; it draws the masks for the
// rendered `.cloze`, `.cloze-inactive` and `.cloze-highlight` divs on a canvas
// over the image.
(function () {
  const SHAPE_MASK_COLOR = "#ffeba2";
  const TEXT_BACKGROUND_COLOR = "#ffffff";
  const TEXT_FONT_FAMILY = "Arial";
  const TEXT_PADDING = 5;
  const TEXT_FONT_SIZE = 40;
  const TEXT_COLOR = "#000000";
  const ANGLE_STEPS = 10000;

  function storedToAngle(x) {
    const angleSteps = Number(x) % ANGLE_STEPS;
    return Number.isNaN(angleSteps) ? null : (angleSteps / ANGLE_STEPS) * 360;
  }

  const xFromNormalized = (size, x) => Math.round(x * size.width);
  const yFromNormalized = (size, y) => Math.round(y * size.height);
  const xToNormalized = (size, x) => x / size.width;
  const yToNormalized = (size, y) => y / size.height;

  class Shape {
    constructor({ left = 0, top = 0, angle = 0, fill = SHAPE_MASK_COLOR, occludeInactive, ordinal } = {}) {
      this.left = left;
      this.top = top;
      this.angle = angle;
      this.fill = fill;
      this.occludeInactive = occludeInactive;
      this.ordinal = ordinal;
    }
    absolutePosition(size) {
      return { left: xFromNormalized(size, this.left), top: yFromNormalized(size, this.top) };
    }
    normalPosition(size) {
      return { left: xToNormalized(size, this.left), top: yToNormalized(size, this.top) };
    }
    toAbsolute(size) {
      return new Shape({ ...this, ...this.absolutePosition(size) });
    }
    toNormal(size) {
      return new Shape({ ...this, ...this.normalPosition(size) });
    }
  }

  class Rectangle extends Shape {
    constructor({ width = 0, height = 0, ...rest } = {}) {
      super(rest);
      this.width = width;
      this.height = height;
      this.id = "rect-" + new Date().getTime();
    }
    toAbsolute(size) {
      return new Rectangle({
        ...this,
        ...this.absolutePosition(size),
        width: xFromNormalized(size, this.width),
        height: yFromNormalized(size, this.height),
      });
    }
    toNormal(size) {
      return new Rectangle({
        ...this,
        ...this.normalPosition(size),
        width: xToNormalized(size, this.width),
        height: yToNormalized(size, this.height),
      });
    }
  }

  class Ellipse extends Shape {
    constructor({ rx = 0, ry = 0, ...rest } = {}) {
      super(rest);
      this.rx = rx;
      this.ry = ry;
      this.id = "ellipse-" + new Date().getTime();
    }
    toAbsolute(size) {
      return new Ellipse({
        ...this,
        ...this.absolutePosition(size),
        rx: xFromNormalized(size, this.rx),
        ry: yFromNormalized(size, this.ry),
      });
    }
    toNormal(size) {
      return new Ellipse({
        ...this,
        ...this.normalPosition(size),
        rx: xToNormalized(size, this.rx),
        ry: yToNormalized(size, this.ry),
      });
    }
  }

  class Polygon extends Shape {
    constructor({ points = [], ...rest } = {}) {
      super(rest);
      this.points = points;
      this.id = "polygon-" + new Date().getTime();
    }
    toAbsolute(size) {
      return new Polygon({
        ...this,
        ...this.absolutePosition(size),
        points: this.points.map((p) => ({ x: xFromNormalized(size, p.x), y: yFromNormalized(size, p.y) })),
      });
    }
    toNormal(size) {
      return new Polygon({
        ...this,
        ...this.normalPosition(size),
        points: this.points.map((p) => ({ x: xToNormalized(size, p.x), y: yToNormalized(size, p.y) })),
      });
    }
  }

  class Text extends Shape {
    constructor({ text = "", scaleX = 1, scaleY = 1, fill = TEXT_COLOR, fontSize, ...rest } = {}) {
      super(rest);
      this.fill = fill;
      this.text = text;
      this.scaleX = scaleX;
      this.scaleY = scaleY;
      this.fontSize = fontSize;
      this.id = "text-" + new Date().getTime();
    }
    toAbsolute(size) {
      return new Text({
        ...this,
        fontSize: this.fontSize ? this.fontSize * size.height : TEXT_FONT_SIZE,
        ...this.absolutePosition(size),
      });
    }
    toNormal(size) {
      const fontSize = this.fontSize ? this.fontSize : TEXT_FONT_SIZE;
      return new Text({ ...this, fontSize: fontSize / size.height, ...this.normalPosition(size) });
    }
  }

  /* ---------- shapes/from-cloze.ts ---------- */

  function buildShape(type, props) {
    props.left = parseFloat(Number.isNaN(Number(props.left)) ? ".0000" : props.left);
    props.top = parseFloat(Number.isNaN(Number(props.top)) ? ".0000" : props.top);
    props.angle = storedToAngle(props.angle) ?? 0;
    switch (type) {
      case "rect":
        return new Rectangle({ ...props, width: parseFloat(props.width), height: parseFloat(props.height) });
      case "ellipse":
        return new Ellipse({ ...props, rx: parseFloat(props.rx), ry: parseFloat(props.ry) });
      case "polygon":
        if (props.points) {
          props.points = props.points.split(" ").map((point) => {
            const [x, y] = point.split(",");
            return { x, y };
          });
        } else {
          props.points = [{ x: 0, y: 0 }];
        }
        return new Polygon(props);
      case "text": {
        const textProps = { ...props, scaleX: parseFloat(props.scale), scaleY: parseFloat(props.scale) };
        if (props.fs) textProps.fontSize = parseFloat(props.fs);
        return new Text(textProps);
      }
    }
    return null;
  }

  function extractShapeFromRenderedCloze(cloze) {
    const type = cloze.dataset.shape;
    if (type !== "rect" && type !== "ellipse" && type !== "polygon" && type !== "text") return null;
    const props = {
      occludeInactive: cloze.dataset.occludeinactive === "1",
      ordinal: parseInt(cloze.dataset.ordinal),
      left: cloze.dataset.left,
      top: cloze.dataset.top,
      width: cloze.dataset.width,
      height: cloze.dataset.height,
      rx: cloze.dataset.rx,
      ry: cloze.dataset.ry,
      points: cloze.dataset.points,
      text: cloze.dataset.text,
      scale: cloze.dataset.scale,
      fs: cloze.dataset.fontSize,
      angle: cloze.dataset.angle,
      ...(cloze.dataset.fill == null ? {} : { fill: cloze.dataset.fill }),
    };
    return buildShape(type, props);
  }

  function extractShapesFromRenderedClozes(selector) {
    return Array.from(document.querySelectorAll(selector)).flatMap((cloze) => {
      if (cloze instanceof HTMLDivElement) return extractShapeFromRenderedCloze(cloze) ?? [];
      return [];
    });
  }

  /* ---------- canvas-scale.ts ---------- */

  function optimumPixelSizeForCanvas(imageSize, containerSize) {
    let { width, height } = imageSize;
    const pixelScale = window.devicePixelRatio;
    const container = { width: containerSize.width * pixelScale, height: containerSize.height * pixelScale };
    const containerScale = Math.min(container.width / imageSize.width, container.height / imageSize.height);
    width *= containerScale;
    height *= containerScale;
    const maximumPixels = 4096 * 4096;
    const requiredPixels = width * height;
    if (requiredPixels > maximumPixels) {
      const shrinkScale = Math.sqrt(maximumPixels) / Math.sqrt(requiredPixels);
      width *= shrinkScale;
      height *= shrinkScale;
    }
    return { width: Math.floor(width), height: Math.floor(height) };
  }

  /* ---------- review.ts ---------- */

  async function waitForImage() {
    const image = document.querySelector("#image-occlusion-container img");
    if (!image || image.complete) return;
    await new Promise((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }

  // For engines without `aspect-ratio`, as upstream keeps it.
  function calculateContainerSize(container, img) {
    const compStyle = getComputedStyle(container);
    const compMaxWidth = parseFloat(compStyle.getPropertyValue("max-width"));
    const vw = container.parentElement.clientWidth;
    const maxWidth = Number.isNaN(compMaxWidth) || compMaxWidth > vw ? vw : compMaxWidth;
    const defaultMaxHeight = document.documentElement.clientHeight * 0.95 - 40;
    const compMaxHeight = parseFloat(compStyle.getPropertyValue("max-height"));
    let maxHeight;
    if (Number.isNaN(compMaxHeight)) {
      maxHeight = Math.max(img.naturalHeight, defaultMaxHeight);
    } else if (compMaxHeight < defaultMaxHeight) {
      maxHeight = compMaxHeight;
    } else {
      maxHeight = Math.max(defaultMaxHeight, Math.min(img.naturalHeight, compMaxHeight));
    }
    const ratio = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight);
    return { width: img.naturalWidth * ratio, height: img.naturalHeight * ratio };
  }

  let lastOptions;
  let hide = false;
  let listenersAdded = false;

  async function setupImageOcclusion(setupOptions) {
    lastOptions = setupOptions;
    hide = false;
    if (!listenersAdded) {
      listenersAdded = true;
      // Masks are redrawn at the new size; the page stays loaded between cards.
      let frame = 0;
      window.addEventListener("resize", () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (document.getElementById("image-occlusion-canvas")) setupImageOcclusionInner(lastOptions);
        });
      });
      window.addEventListener("keydown", (event) => {
        const button = document.getElementById("toggle");
        if (button && button.style.display !== "none" && event.key === "M") toggleMasks(lastOptions);
      });
    }
    await waitForImage();
    window.requestAnimationFrame(() => setupImageOcclusionInner(setupOptions));
  }

  function setupImageOcclusionInner(setupOptions) {
    const canvas = document.querySelector("#image-occlusion-canvas");
    if (canvas == null) return;
    const container = document.getElementById("image-occlusion-container");
    const image = document.querySelector("#image-occlusion-container img");
    if (image == null) {
      // Anki's notetype-error-no-image-to-show; the card page has no translations.
      container.innerText = "No image to show.";
      return;
    }

    if (CSS.supports("aspect-ratio: 1")) {
      container.style.aspectRatio = `${image.naturalWidth / image.naturalHeight}`;
    } else {
      const containerSize = calculateContainerSize(container, image);
      container.style.width = `${containerSize.width}px`;
      container.style.height = `${containerSize.height}px`;
    }

    const size = optimumPixelSizeForCanvas(
      { width: image.naturalWidth, height: image.naturalHeight },
      { width: canvas.clientWidth, height: canvas.clientHeight },
    );
    canvas.width = size.width;
    canvas.height = size.height;

    const button = document.getElementById("toggle");
    if (button) {
      if (document.querySelector('[data-occludeinactive="1"]')) {
        if (!button.dataset.hayakiToggle) {
          button.dataset.hayakiToggle = "1";
          button.addEventListener("click", () => toggleMasks(lastOptions));
        }
      } else {
        button.style.display = "none";
      }
    }

    drawShapes(canvas, setupOptions?.onWillDrawShapes, setupOptions?.onDidDrawShapes, hide ? [Text] : undefined);
  }

  function drawShapes(canvas, onWillDrawShapes, onDidDrawShapes, allowedShapes) {
    const context = canvas.getContext("2d");
    const size = canvas;
    const filterByAllowedShapes = (el) =>
      allowedShapes && allowedShapes.length > 0 ? allowedShapes.some((s) => el instanceof s) : true;

    let activeShapes = extractShapesFromRenderedClozes(".cloze").filter(filterByAllowedShapes);
    let inactiveShapes = extractShapesFromRenderedClozes(".cloze-inactive").filter(filterByAllowedShapes);
    let highlightShapes = extractShapesFromRenderedClozes(".cloze-highlight").filter(filterByAllowedShapes);
    let properties = getShapeProperties();

    const processed = onWillDrawShapes?.({ activeShapes, inactiveShapes, highlightShapes, properties }, context);
    if (processed) {
      activeShapes = processed.activeShapes;
      inactiveShapes = processed.inactiveShapes;
      highlightShapes = processed.highlightShapes;
      properties = processed.properties;
    }

    for (const shape of activeShapes) {
      drawShape({
        context,
        size,
        shape,
        fill: properties.activeShapeColor,
        stroke: properties.activeBorder.color,
        strokeWidth: properties.activeBorder.width,
      });
    }
    for (const shape of inactiveShapes.filter((s) => s.occludeInactive)) {
      drawShape({
        context,
        size,
        shape,
        fill: shape.fill !== SHAPE_MASK_COLOR ? shape.fill : properties.inActiveShapeColor,
        stroke: properties.inActiveBorder.color,
        strokeWidth: properties.inActiveBorder.width,
      });
    }
    for (const shape of highlightShapes) {
      drawShape({
        context,
        size,
        shape,
        fill: properties.highlightShapeColor,
        stroke: properties.highlightShapeBorder.color,
        strokeWidth: properties.highlightShapeBorder.width,
      });
    }

    onDidDrawShapes?.({ activeShapes, inactiveShapes, highlightShapes, properties }, context);
  }

  function drawShape({ context: ctx, size, shape, fill, stroke, strokeWidth }) {
    shape = shape.toAbsolute(size);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    const angle = ((shape.angle ?? 0) * Math.PI) / 180;
    if (shape instanceof Rectangle) {
      if (angle) {
        ctx.save();
        ctx.translate(shape.left, shape.top);
        ctx.rotate(angle);
        ctx.translate(-shape.left, -shape.top);
      }
      ctx.fillRect(shape.left, shape.top, shape.width, shape.height);
      // ctx stroke methods draw a visible stroke even when the width is 0
      if (strokeWidth) ctx.strokeRect(shape.left, shape.top, shape.width, shape.height);
      if (angle) ctx.restore();
    } else if (shape instanceof Ellipse) {
      const adjustedLeft = shape.left + shape.rx;
      const adjustedTop = shape.top + shape.ry;
      if (angle) {
        ctx.save();
        ctx.translate(shape.left, shape.top);
        ctx.rotate(angle);
        ctx.translate(-shape.left, -shape.top);
      }
      ctx.beginPath();
      ctx.ellipse(adjustedLeft, adjustedTop, shape.rx, shape.ry, 0, 0, Math.PI * 2, false);
      ctx.closePath();
      ctx.fill();
      if (strokeWidth) ctx.stroke();
      if (angle) ctx.restore();
    } else if (shape instanceof Polygon) {
      const offset = getPolygonOffset(shape);
      ctx.save();
      ctx.translate(offset.x, offset.y);
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 0; i < shape.points.length; i++) ctx.lineTo(shape.points[i].x, shape.points[i].y);
      ctx.closePath();
      ctx.fill();
      if (strokeWidth) ctx.stroke();
      ctx.restore();
    } else if (shape instanceof Text) {
      ctx.save();
      ctx.font = `${shape.fontSize}px ${TEXT_FONT_FAMILY}`;
      ctx.textBaseline = "top";
      ctx.scale(shape.scaleX, shape.scaleY);
      const lines = shape.text.split("\n");
      const baseMetrics = ctx.measureText("M");
      const fontHeight = baseMetrics.actualBoundingBoxAscent + baseMetrics.actualBoundingBoxDescent;
      const lineHeight = 1.5 * fontHeight;
      const linePositions = [];
      let maxWidth = 0;
      let totalHeight = 0;
      for (let i = 0; i < lines.length; i++) {
        const textMetrics = ctx.measureText(lines[i]);
        linePositions.push({
          text: lines[i],
          x: shape.left / shape.scaleX,
          y: shape.top / shape.scaleY + i * lineHeight,
        });
        if (textMetrics.width > maxWidth) maxWidth = textMetrics.width;
        totalHeight += lineHeight;
      }
      const left = shape.left / shape.scaleX;
      const top = shape.top / shape.scaleY;
      if (angle) {
        ctx.translate(left, top);
        ctx.rotate(angle);
        ctx.translate(-left, -top);
      }
      ctx.fillStyle = TEXT_BACKGROUND_COLOR;
      ctx.fillRect(left, top, maxWidth + TEXT_PADDING, totalHeight + TEXT_PADDING);
      ctx.fillStyle = shape.fill ?? "#000";
      for (const line of linePositions) ctx.fillText(line.text, line.x, line.y);
      ctx.restore();
    }
  }

  function getPolygonOffset(polygon) {
    const topLeft = topLeftOfPoints(polygon.points);
    return { x: polygon.left - topLeft.x, y: polygon.top - topLeft.y };
  }

  function topLeftOfPoints(points) {
    let top = points[0].y;
    let left = points[0].x;
    for (const point of points) {
      if (point.y < top) top = point.y;
      if (point.x < left) left = point.x;
    }
    return { x: left, y: top };
  }

  function getShapeProperties() {
    const canvas = document.getElementById("image-occlusion-canvas");
    const computedStyle = window.getComputedStyle(canvas);
    try {
      const activeShapeColor = computedStyle.getPropertyValue("--active-shape-color");
      const inActiveShapeColor = computedStyle.getPropertyValue("--inactive-shape-color");
      const highlightShapeColor = computedStyle.getPropertyValue("--highlight-shape-color");
      const inActiveBorder = computedStyle.getPropertyValue("--inactive-shape-border").split(" ").filter((x) => x);
      const inActiveShapeBorderWidth = parseFloat(inActiveBorder[0]);
      const inActiveShapeBorderColor = inActiveBorder[1];
      const activeBorder = computedStyle.getPropertyValue("--active-shape-border").split(" ").filter((x) => x);
      const activeShapeBorderWidth = parseFloat(activeBorder[0]);
      const activeShapeBorderColor = activeBorder[1];
      const highlightBorder = computedStyle.getPropertyValue("--highlight-shape-border").split(" ").filter((x) => x);
      const highlightShapeBorderWidth = parseFloat(highlightBorder[0]);
      const highlightShapeBorderColor = highlightBorder[1];
      return {
        activeShapeColor: activeShapeColor ? activeShapeColor : "#ff8e8e",
        inActiveShapeColor: inActiveShapeColor ? inActiveShapeColor : SHAPE_MASK_COLOR,
        highlightShapeColor: highlightShapeColor ? highlightShapeColor : "#ff8e8e00",
        activeBorder: {
          width: !isNaN(activeShapeBorderWidth) ? activeShapeBorderWidth : 1,
          color: activeShapeBorderColor ? activeShapeBorderColor : "#212121",
        },
        inActiveBorder: {
          width: !isNaN(inActiveShapeBorderWidth) ? inActiveShapeBorderWidth : 1,
          color: inActiveShapeBorderColor ? inActiveShapeBorderColor : "#212121",
        },
        highlightShapeBorder: {
          width: !isNaN(highlightShapeBorderWidth) ? highlightShapeBorderWidth : 1,
          color: highlightShapeBorderColor ? highlightShapeBorderColor : "#ff8e8e",
        },
      };
    } catch {
      return {
        activeShapeColor: "#ff8e8e",
        inActiveShapeColor: "#ffeba2",
        highlightShapeColor: "#ff8e8e00",
        activeBorder: { width: 1, color: "#212121" },
        inActiveBorder: { width: 1, color: "#212121" },
        highlightShapeBorder: { width: 1, color: "#ff8e8e" },
      };
    }
  }

  function toggleMasks(setupOptions) {
    const canvas = document.getElementById("image-occlusion-canvas");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    hide = !hide;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (hide) {
      drawShapes(canvas, setupOptions?.onWillDrawShapes, setupOptions?.onDidDrawShapes, [Text]);
      return;
    }
    drawShapes(canvas, setupOptions?.onWillDrawShapes, setupOptions?.onDidDrawShapes);
  }

  window.anki = window.anki || {};
  window.anki.imageOcclusion = {
    setup: setupImageOcclusion,
    drawShape,
    Ellipse,
    Polygon,
    Rectangle,
    Shape,
    Text,
  };
  // The name older Image Occlusion templates call.
  window.anki.setupImageCloze = setupImageOcclusion;
})();
