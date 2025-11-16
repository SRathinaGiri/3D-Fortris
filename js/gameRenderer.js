import * as THREE from '../vendor/three/three.module.js';
import { AnaglyphEffect } from '../vendor/three/AnaglyphEffect.js';
import { BOARD_SIZE } from './constants.js';

const BLOCK_SIZE = 0.9;

export class GameRenderer {
  constructor(container) {
    this.container = container;
    this.viewType = 'perspective';
    this.stereoSettings = { eyeDistance: 0.065, focusDepth: 5, fov: 60 };
    this.materialCache = { geometry: new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE) };
    this.frameHandle = null;
    this.handleResize = () => this.resize();
    this.init();
  }

  init() {
    const { clientWidth, clientHeight } = this.container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#020617');

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(clientWidth, clientHeight);
    this.container.appendChild(this.renderer.domElement);

    this.perspectiveCamera = new THREE.PerspectiveCamera(60, clientWidth / clientHeight, 0.1, 100);
    this.perspectiveCamera.position.set(10, 12, 14);
    this.perspectiveCamera.lookAt(0, 0, 0);

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

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_SIZE.width * BLOCK_SIZE + 2, 0.2, BOARD_SIZE.depth * BLOCK_SIZE + 2),
      new THREE.MeshStandardMaterial({ color: '#0f172a' }),
    );
    floor.position.y = -(BOARD_SIZE.height / 2) * BLOCK_SIZE - 0.6;
    this.scene.add(floor);

    this.blockGroup = new THREE.Group();
    this.scene.add(this.blockGroup);

    window.addEventListener('resize', this.handleResize);
    this.renderLoop = this.renderLoop.bind(this);
    this.renderLoop();
  }

  update(state) {
    this.viewType = state.viewType;
    this.stereoSettings = state.stereoSettings;
    this.populateBlocks(state.grid, state.activePiece, state.clearingLayers);
  }

  populateBlocks(grid, activePiece, clearingLayers = []) {
    if (!this.blockGroup) return;
    const geometry = this.materialCache.geometry;
    this.blockGroup.clear();
    const offset = {
      x: -(BOARD_SIZE.width / 2) + 0.5,
      y: -(BOARD_SIZE.height / 2) + 0.5,
      z: -(BOARD_SIZE.depth / 2) + 0.5,
    };

    const materialCache = this.materialCache;
    const getMaterial = (color, options = {}) => {
      const key = `${color}-${options.transparent ? 't' : 'o'}-${options.emissive ?? '0'}-${options.opacity ?? 1}`;
      if (!materialCache[key]) {
        materialCache[key] = new THREE.MeshStandardMaterial({
          color,
          transparent: Boolean(options.transparent),
          opacity: options.transparent ? options.opacity ?? 0.35 : 1,
          emissive: options.emissive ? new THREE.Color(options.emissive) : undefined,
        });
      }
      return materialCache[key];
    };

    const createCube = (position, color, options = {}) => {
      const mesh = new THREE.Mesh(geometry, getMaterial(color, options));
      mesh.position.set(
        (position.x + offset.x) * BLOCK_SIZE,
        (position.y + offset.y) * BLOCK_SIZE,
        (position.z + offset.z) * BLOCK_SIZE,
      );
      this.blockGroup.add(mesh);
    };

    grid.forEach((layer, y) => {
      layer.forEach((row, z) => {
        row.forEach((cell, x) => {
          if (cell) {
            const highlight = clearingLayers.includes(y);
            createCube({ x, y, z }, cell.color, highlight ? { emissive: '#f472b6' } : {});
          }
        });
      });
    });

    if (activePiece) {
      activePiece.cells.forEach(([cx, cy, cz]) => {
        const x = activePiece.position.x + cx;
        const y = activePiece.position.y + cy;
        const z = activePiece.position.z + cz;
        createCube({ x, y, z }, activePiece.color, { transparent: true, opacity: 0.45 });
      });
    }
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
    this.frameHandle = requestAnimationFrame(this.renderLoop);
    this.draw();
  }

  draw() {
    if (!this.renderer || !this.scene) return;
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

  destroy() {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.handleResize);
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }
}
