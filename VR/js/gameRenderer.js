import * as THREE from '../vendor/three/three.module.js';
import { AnaglyphEffect } from '../vendor/three/AnaglyphEffect.js';
import { VRButton } from '../vendor/three/VRButton.js';
import { DEFAULT_BOARD_SIZE } from './constants.js';

const BLOCK_SIZE = 0.9;
const LANDING_COLOR = '#38bdf8';
const EDGE_COLOR = '#0f172a';

const hasWebGLSupport = () => {
  try {
    if (!window.WebGLRenderingContext) return false;
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch (error) {
    return false;
  }
};

export class GameRenderer {
  constructor(container) {
    this.container = container;
    this.viewType = 'perspective';
    this.stereoSettings = { eyeDistance: 0.065, focusDepth: 5, fov: 60 };
    this.boardSize = { ...DEFAULT_BOARD_SIZE };
    this.materialCache = { geometry: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE) };
    this.materialCache.edgeGeometry = new THREE.EdgesGeometry(this.materialCache.geometry);
    this.edgeMaterialCache = {};
    this.frameHandle = null;
    this.handleResize = () => this.resize();
    this.floorY = -(this.boardSize.height / 2) * BLOCK_SIZE - 0.5;
    this.landingGeometry = new THREE.CircleGeometry(0.3, 32);
    this.landingMaterial = new THREE.MeshBasicMaterial({
      color: LANDING_COLOR,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    });
    this.cubeOpacity = 1;
    this.isStereoWide = false;
    this.cameraOrbit = { theta: Math.PI / 4, phi: 1.05, radius: 18 };
    this.pointerState = { dragging: false, lastX: 0, lastY: 0 };
    this.pointerHandlers = {};
    this.autoRotateSpeed = 0.0009;
    this.autoRotateEnabled = true;
    this.orbitListeners = new Set();
    this.lastCameraTheta = this.cameraOrbit.theta;
    this.init();
  }

  init() {
    if (!this.container) {
      this.errorMessage = 'Unable to find a surface to render the game.';
      return;
    }
    if (!hasWebGLSupport()) {
      this.showFallback('WebGL is not available in this browser. Enable hardware acceleration or try a different browser.');
      return;
    }

    const { clientWidth, clientHeight } = this.container;
    try {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color('#020617');

      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.setSize(clientWidth, clientHeight);
      this.renderer.xr.enabled = true;
      this.container.appendChild(this.renderer.domElement);
      document.body.appendChild(VRButton.createButton(this.renderer));
      this.bindPointerControls();

      this.perspectiveCamera = new THREE.PerspectiveCamera(60, clientWidth / clientHeight, 0.1, 100);
      this.perspectiveCamera.position.set(10, 12, 14);
      this.perspectiveCamera.lookAt(0, 0, 0);
      this.updateCameraOrbit(true);

      const orthoSize = 10;
      this.orthoCamera = new THREE.OrthographicCamera(
        -orthoSize,
        orthoSize,
        orthoSize,
        -orthoSize,
        0.1,
        100,
      );
      this.orthoCamera.position.set(0, 18, 0);
      this.orthoCamera.lookAt(0, 0, 0);

      this.stereoCamera = new THREE.StereoCamera();
      this.anaglyphEffect = new AnaglyphEffect(this.renderer);
      this.anaglyphEffect.setSize(clientWidth, clientHeight);

      const ambient = new THREE.AmbientLight('#ffffff', 0.7);
      const keyLight = new THREE.DirectionalLight('#f8fafc', 0.7);
      keyLight.position.set(10, 10, 10);
      const rimLight = new THREE.PointLight('#93c5fd', 0.4);
      rimLight.position.set(-8, 15, -8);
      this.scene.add(ambient, keyLight, rimLight);

      this.floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(
          this.boardSize.width * BLOCK_SIZE + 1.5,
          this.boardSize.depth * BLOCK_SIZE + 1.5,
        ),
        new THREE.MeshStandardMaterial({ color: '#0f172a', metalness: 0.2, roughness: 0.85, side: THREE.DoubleSide }),
      );
      this.floorMesh.rotation.x = -Math.PI / 2;
      this.floorMesh.position.y = this.floorY - 0.05;
      this.scene.add(this.floorMesh);

      this.floorGrid = this.createFloorGrid();
      this.scene.add(this.floorGrid);

      this.blockGroup = new THREE.Group();
      this.scene.add(this.blockGroup);

      this.landingGroup = new THREE.Group();
      this.scene.add(this.landingGroup);
    } catch (error) {
      console.error('Failed to initialize WebGL renderer', error);
      if (this.renderer) {
        this.renderer.dispose();
        this.renderer = null;
      }
      this.showFallback('3D rendering failed to start. Please enable WebGL or update your graphics drivers to continue.');
      return;
    }

    this.errorMessage = '';
    this.ready = true;
    window.addEventListener('resize', this.handleResize);
    this.renderLoop = this.renderLoop.bind(this);
    this.renderer.setAnimationLoop(this.renderLoop);
  }

  setBoardSize(boardSize) {
    if (!boardSize) return;
    const changed =
      !this.boardSize ||
      this.boardSize.width !== boardSize.width ||
      this.boardSize.depth !== boardSize.depth ||
      this.boardSize.height !== boardSize.height;
    if (!changed) return;
    this.boardSize = { ...this.boardSize, ...boardSize };
    this.floorY = -(this.boardSize.height / 2) * BLOCK_SIZE - 0.5;
    this.rebuildFloorElements();
  }

  rebuildFloorElements() {
    if (this.floorMesh) {
      this.floorMesh.geometry.dispose();
      this.floorMesh.geometry = new THREE.PlaneGeometry(
        this.boardSize.width * BLOCK_SIZE + 1.5,
        this.boardSize.depth * BLOCK_SIZE + 1.5,
      );
      this.floorMesh.position.y = this.floorY - 0.05;
    }
    if (this.floorGrid) {
      this.scene.remove(this.floorGrid);
      if (this.floorGrid.geometry) {
        this.floorGrid.geometry.dispose();
      }
      this.floorGrid = this.createFloorGrid();
      this.scene.add(this.floorGrid);
    }
  }

  update(state) {
    if (!this.ready) return;
    this.setBoardSize(state.boardSize);
    this.viewType = state.viewType;
    this.stereoSettings = state.stereoSettings;
    this.cubeOpacity = state.cubeOpacity ?? 1;
    const requiresWideCanvas = this.viewType === 'cross' || this.viewType === 'parallel';
    if (this.container && this.isStereoWide !== requiresWideCanvas) {
      this.isStereoWide = requiresWideCanvas;
      this.container.classList.toggle('game-canvas--stereo', requiresWideCanvas);
      this.resize();
    }
    this.populateBlocks(state.grid, state.activePiece, state.clearingLayers);
  }

  populateBlocks(grid, activePiece, clearingLayers = []) {
    if (!this.blockGroup) return;
    const geometry = this.materialCache.geometry;
    const edgeGeometry = this.materialCache.edgeGeometry;
    this.blockGroup.clear();
    const offset = {
      x: -(this.boardSize.width / 2) + 0.5,
      y: -(this.boardSize.height / 2) + 0.5,
      z: -(this.boardSize.depth / 2) + 0.5,
    };

    const materialCache = this.materialCache;
    const edgeMaterialCache = this.edgeMaterialCache;
    const getMaterial = (color, options = {}) => {
      const key = `${color}-${options.transparent ? 't' : 'o'}-${options.emissive ?? '0'}-${options.opacity ?? 1}`;
      if (!materialCache[key]) {
        const materialOptions = {
          color,
          transparent: Boolean(options.transparent),
          opacity: options.transparent ? options.opacity ?? 0.35 : 1,
        };
        if (options.emissive) {
          materialOptions.emissive = new THREE.Color(options.emissive);
        }
        materialCache[key] = new THREE.MeshStandardMaterial(materialOptions);
      }
      return materialCache[key];
    };

    const getEdgeMaterial = (options = {}) => {
      const opacity = options.transparent ? options.opacity ?? 0.35 : 1;
      const key = `edge-${opacity.toFixed(2)}`;
      if (!edgeMaterialCache[key]) {
        edgeMaterialCache[key] = new THREE.LineBasicMaterial({
          color: EDGE_COLOR,
          transparent: opacity < 1,
          opacity,
          depthWrite: false,
        });
      }
      return edgeMaterialCache[key];
    };

    const createCube = (position, color, options = {}) => {
      const mesh = new THREE.Mesh(geometry, getMaterial(color, options));
      mesh.position.set(
        (position.x + offset.x) * BLOCK_SIZE,
        (position.y + offset.y) * BLOCK_SIZE,
        (position.z + offset.z) * BLOCK_SIZE,
      );
      this.blockGroup.add(mesh);
      if (edgeGeometry) {
        const edge = new THREE.LineSegments(edgeGeometry, getEdgeMaterial(options));
        edge.position.copy(mesh.position);
        edge.scale.set(1.002, 1.002, 1.002);
        edge.renderOrder = 1;
        this.blockGroup.add(edge);
      }
    };

    const lockedOpacity = Math.max(0.2, Math.min(1, this.cubeOpacity ?? 1));
    const lockedTransparent = lockedOpacity < 1;
    const floatingOpacity = Math.max(0.2, Math.min(1, this.cubeOpacity ?? 1));
    const floatingTransparent = floatingOpacity < 1;
    grid.forEach((layer, y) => {
      layer.forEach((row, z) => {
        row.forEach((cell, x) => {
          if (cell) {
            const highlight = clearingLayers.includes(y);
            const options = { transparent: lockedTransparent, opacity: lockedOpacity };
            if (highlight) {
              options.emissive = '#f472b6';
            }
            createCube({ x, y, z }, cell.color, options);
          }
        });
      });
    });

    let landingPiece = null;
    let landingFootprint = [];
    if (activePiece) {
      landingPiece = this.computeLandingPiece(activePiece, grid);
      if (landingPiece) {
        landingFootprint = this.getLandingFootprint(landingPiece);
        if (landingPiece.position.y !== activePiece.position.y) {
          landingPiece.cells.forEach(([cx, cy, cz]) => {
            const x = landingPiece.position.x + cx;
            const y = landingPiece.position.y + cy;
            const z = landingPiece.position.z + cz;
            createCube({ x, y, z }, LANDING_COLOR, { transparent: true, opacity: 0.18 });
          });
        }
      }

      activePiece.cells.forEach(([cx, cy, cz]) => {
        const x = activePiece.position.x + cx;
        const y = activePiece.position.y + cy;
        const z = activePiece.position.z + cz;
        createCube(
          { x, y, z },
          activePiece.color,
          { transparent: floatingTransparent, opacity: floatingOpacity },
        );
      });
    }

    this.renderLandingMarkers(landingFootprint);
  }

  computeLandingPiece(piece, grid) {
    if (!piece) return null;
    const landingPosition = { ...piece.position };
    const canDescend = () =>
      piece.cells.every(([cx, cy, cz]) => {
        const x = landingPosition.x + cx;
        const z = landingPosition.z + cz;
        const nextY = landingPosition.y + cy - 1;
        if (x < 0 || x >= this.boardSize.width) return false;
        if (z < 0 || z >= this.boardSize.depth) return false;
        if (nextY < 0) return false;
        const layer = grid[nextY];
        if (!layer) return false;
        const row = layer[z];
        if (!row) return false;
        return !row[x];
      });

    while (canDescend()) {
      landingPosition.y -= 1;
    }

    return { ...piece, position: { ...piece.position, y: landingPosition.y } };
  }

  getLandingFootprint(piece) {
    if (!piece) return [];
    const footprint = new Map();
    piece.cells.forEach(([cx, cy, cz]) => {
      const x = piece.position.x + cx;
      const z = piece.position.z + cz;
      const y = piece.position.y + cy;
      const key = `${x}:${z}`;
      const entry = footprint.get(key);
      if (!entry || y < entry.y) {
        footprint.set(key, { x, z, y });
      }
    });
    return Array.from(footprint.values());
  }

  getSupportSurfaceY(supportIndex) {
    if (supportIndex < 0) {
      return this.floorY + 0.01;
    }
    const offsetY = -(this.boardSize.height / 2) + 0.5;
    return (supportIndex + offsetY) * BLOCK_SIZE + BLOCK_SIZE / 2 + 0.01;
  }

  renderLandingMarkers(footprint) {
    if (!this.landingGroup) return;
    this.landingGroup.clear();
    if (!footprint.length) return;
    footprint.forEach(({ x, z, y }) => {
      const marker = new THREE.Mesh(this.landingGeometry, this.landingMaterial);
      marker.rotation.x = -Math.PI / 2;
      const supportSurface = this.getSupportSurfaceY(y - 1);
      marker.position.set(
        (x - this.boardSize.width / 2 + 0.5) * BLOCK_SIZE,
        supportSurface,
        (z - this.boardSize.depth / 2 + 0.5) * BLOCK_SIZE,
      );
      this.landingGroup.add(marker);
    });
  }

  createFloorGrid() {
    const vertices = [];
    const width = this.boardSize.width;
    const depth = this.boardSize.depth;
    for (let x = 0; x <= width; x += 1) {
      const offsetX = (x - width / 2) * BLOCK_SIZE;
      vertices.push(offsetX, 0, -(depth / 2) * BLOCK_SIZE);
      vertices.push(offsetX, 0, (depth / 2) * BLOCK_SIZE);
    }
    for (let z = 0; z <= depth; z += 1) {
      const offsetZ = (z - depth / 2) * BLOCK_SIZE;
      vertices.push(-(width / 2) * BLOCK_SIZE, 0, offsetZ);
      vertices.push((width / 2) * BLOCK_SIZE, 0, offsetZ);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({ color: '#1d4ed8', transparent: true, opacity: 0.35 });
    const grid = new THREE.LineSegments(geometry, material);
    grid.position.y = this.floorY + 0.01;
    return grid;
  }

  bindPointerControls() {
    if (!this.renderer) return;
    const canvas = this.renderer.domElement;
    if (!canvas) return;

    this.pointerHandlers.down = (event) => {
      event.preventDefault();
      this.pointerState.dragging = true;
      this.pointerState.lastX = event.clientX;
      this.pointerState.lastY = event.clientY;
    };

    this.pointerHandlers.move = (event) => {
      if (!this.pointerState.dragging) return;
      const dx = event.clientX - this.pointerState.lastX;
      const dy = event.clientY - this.pointerState.lastY;
      this.cameraOrbit.theta -= dx * 0.004;
      this.cameraOrbit.phi -= dy * 0.004;
      this.pointerState.lastX = event.clientX;
      this.pointerState.lastY = event.clientY;
      this.notifyCameraOrbitChange();
      this.updateCameraOrbit(true);
    };

    this.pointerHandlers.up = () => {
      this.pointerState.dragging = false;
    };

    this.pointerHandlers.wheel = (event) => {
      event.preventDefault();
      this.cameraOrbit.radius += event.deltaY * 0.01;
      this.updateCameraOrbit(true);
    };

    canvas.addEventListener('pointerdown', this.pointerHandlers.down);
    window.addEventListener('pointermove', this.pointerHandlers.move);
    window.addEventListener('pointerup', this.pointerHandlers.up);
    window.addEventListener('pointercancel', this.pointerHandlers.up);
    canvas.addEventListener('wheel', this.pointerHandlers.wheel, { passive: false });
  }

  updateCameraOrbit() {
    if (!this.perspectiveCamera) return;
    const phi = THREE.MathUtils.clamp(this.cameraOrbit.phi, 0.3, Math.PI - 0.3);
    const radius = THREE.MathUtils.clamp(this.cameraOrbit.radius, 7, 28);
    this.cameraOrbit.phi = phi;
    this.cameraOrbit.radius = radius;
    const sinPhi = Math.sin(phi);
    const x = radius * sinPhi * Math.cos(this.cameraOrbit.theta);
    const z = radius * sinPhi * Math.sin(this.cameraOrbit.theta);
    const y = radius * Math.cos(phi) + 2;
    this.perspectiveCamera.position.set(x, y, z);
    this.perspectiveCamera.lookAt(0, 0, 0);
  }

  animateOrbit() {
    if (this.autoRotateEnabled && !this.pointerState.dragging) {
      this.cameraOrbit.theta += this.autoRotateSpeed;
      this.notifyCameraOrbitChange();
    }
    if (this.viewType !== 'top') {
      this.updateCameraOrbit();
    }
  }

  onCameraOrbitChange(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    this.orbitListeners.add(listener);
    listener({ theta: this.cameraOrbit.theta });
    return () => {
      this.orbitListeners.delete(listener);
    };
  }

  notifyCameraOrbitChange() {
    if (!this.orbitListeners.size) return;
    if (typeof this.lastCameraTheta !== 'number') {
      this.lastCameraTheta = this.cameraOrbit.theta;
    }
    if (Math.abs(this.cameraOrbit.theta - this.lastCameraTheta) < 0.0001) {
      return;
    }
    this.lastCameraTheta = this.cameraOrbit.theta;
    this.orbitListeners.forEach((listener) => listener({ theta: this.cameraOrbit.theta }));
  }

  setAutoRotate(enabled) {
    this.autoRotateEnabled = Boolean(enabled);
  }

  resize() {
    if (!this.renderer || !this.container) return;
    const { clientWidth, clientHeight } = this.container;
    this.renderer.setSize(clientWidth, clientHeight);
    this.perspectiveCamera.aspect = clientWidth / clientHeight;
    this.perspectiveCamera.updateProjectionMatrix();
    this.anaglyphEffect.setSize(clientWidth, clientHeight);
  }

  renderLoop() {
    this.animateOrbit();
    this.draw();
  }

  draw() {
    if (!this.ready || !this.renderer || !this.scene) return;
    const view = this.viewType;
    if (view === 'top') {
      this.renderer.render(this.scene, this.orthoCamera);
      return;
    }

    if (view === 'anaglyph') {
      this.anaglyphEffect.render(this.scene, this.perspectiveCamera);
      return;
    }

    if (view === 'stereo' || view === 'cross' || view === 'parallel') {
      this.renderStereo(view);
      return;
    }

    this.renderer.render(this.scene, this.perspectiveCamera);
  }

  renderStereo(mode) {
    const camera = this.perspectiveCamera;
    const renderer = this.renderer;
    if (!renderer) return;
    camera.fov = this.stereoSettings.fov;
    camera.updateProjectionMatrix();
    this.stereoCamera.eyeSep = this.stereoSettings.eyeDistance * 5;
    this.stereoCamera.focus = this.stereoSettings.focusDepth;
    this.stereoCamera.update(camera);

    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const halfWidth = Math.floor(width / 2);
    renderer.setScissorTest(true);

    const leftCam = mode === 'cross' ? this.stereoCamera.cameraR : this.stereoCamera.cameraL;
    const rightCam = mode === 'cross' ? this.stereoCamera.cameraL : this.stereoCamera.cameraR;

    renderer.setScissor(0, 0, halfWidth, height);
    renderer.setViewport(0, 0, halfWidth, height);
    renderer.render(this.scene, leftCam);

    renderer.setScissor(halfWidth, 0, halfWidth, height);
    renderer.setViewport(halfWidth, 0, halfWidth, height);
    renderer.render(this.scene, rightCam);

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
  }

  isReady() {
    return this.ready;
  }

  getErrorMessage() {
    return this.errorMessage;
  }

  showFallback(message) {
    this.ready = false;
    this.errorMessage = message;
    if (!this.container) return;
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'game-canvas__fallback';
    const text = document.createElement('p');
    text.textContent = message;
    const tip = document.createElement('p');
    tip.className = 'game-canvas__fallback-tip';
    tip.textContent = 'Try enabling hardware acceleration or switching to a WebGL-compatible browser to continue playing.';
    wrapper.appendChild(text);
    wrapper.appendChild(tip);
    this.container.appendChild(wrapper);
    this.fallbackEl = wrapper;
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.handleResize);
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.removeEventListener('pointerdown', this.pointerHandlers.down);
      this.renderer.domElement.removeEventListener('wheel', this.pointerHandlers.wheel);
    }
    window.removeEventListener('pointermove', this.pointerHandlers.move);
    window.removeEventListener('pointerup', this.pointerHandlers.up);
    window.removeEventListener('pointercancel', this.pointerHandlers.up);
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
    if (this.fallbackEl && this.fallbackEl.parentNode === this.container) {
      this.container.removeChild(this.fallbackEl);
    }
    this.orbitListeners.clear();
  }
}
