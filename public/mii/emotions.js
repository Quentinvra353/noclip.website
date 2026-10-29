// Mii Studio: grabs every expression face of the Mii opened in Mi Creator's "Rendu personnalisé"
// screen and downloads them as one file, to import in Mii Studio (noclip fork).
// Loaded by a bookmarklet on https://mii.nxw.pw; it only reads what the page already renders.
(() => {
    'use strict';

    // Expression ids in the order Mi Creator lists them in its Expression tab.
    const EXPRESSION_IDS = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
        30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 45, 47, 48, 49, 51, 53, 55, 56, 57, 58, 59, 60, 61, 63, 64,
        65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81,
    ];

    function banner(text, done) {
        let b = document.getElementById('mii-studio-banner');
        if (b === null) {
            b = document.createElement('div');
            b.id = 'mii-studio-banner';
            b.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;' +
                'max-width:560px;padding:12px 16px;border-radius:10px;background:#1d1530;color:#fff;font:14px/1.4 sans-serif;' +
                'box-shadow:0 4px 20px rgba(0,0,0,.5);border:2px solid #a070ff;white-space:pre-line;cursor:pointer';
            b.title = 'Cliquer pour fermer';
            b.onclick = () => b.remove();
        }
        // The Custom Render screen sits in the top layer, so the banner has to live inside it to be seen.
        const host = document.querySelector('dialog[open]') ?? document.querySelector('.modal-body')?.parentElement ?? document.body;
        if (b.parentElement !== host)
            host.appendChild(b);
        b.textContent = text;
        if (done)
            setTimeout(() => b.remove(), 15000);
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

    // three.js announces every new renderer to window.__THREE_DEVTOOLS__ when it exists. We remember
    // the last scene each one draws on screen, which is the Mii shown in the Custom Render screen.
    function installHook() {
        if (window.__miiStudioCapture !== undefined)
            return window.__miiStudioCapture;
        const cap = { onscreen: null };
        const previous = window.__THREE_DEVTOOLS__;
        const target = new EventTarget();
        target.addEventListener('observe', (e) => {
            const r = e.detail;
            if (r && r.domElement && r.getContext && r.render && !r.__miiStudioHooked) {
                r.__miiStudioHooked = true;
                const render = r.render;
                r.render = function (scene, camera) {
                    if (this.getRenderTarget() === null && this.domElement.isConnected)
                        cap.onscreen = { renderer: this, scene };
                    return render.call(this, scene, camera);
                };
            }
            if (previous && previous.dispatchEvent)
                previous.dispatchEvent(new CustomEvent(e.type, { detail: r }));
        });
        window.__THREE_DEVTOOLS__ = target;
        window.__miiStudioCapture = cap;
        return cap;
    }

    // The face mesh of the Mii on screen; its texture is the face with the current expression.
    function findMask(cap) {
        const o = cap.onscreen;
        if (o === null || !o.renderer.domElement.isConnected)
            return null;
        let mesh = null;
        o.scene.traverse((m) => {
            if (m.isMesh && m.geometry && m.geometry.userData && m.geometry.userData.modulateType === 6 && m.material && m.material.map)
                mesh = m;
        });
        if (mesh === null)
            return null;
        const tex = mesh.material.map;
        if (!hasPixels(tex) && !o.renderer.properties.get(tex).__webglTexture)
            return null;
        return { renderer: o.renderer, tex };
    }

    function findExpressionGrid() {
        for (const g of document.querySelectorAll('.feature-set-group'))
            if (g.offsetParent !== null && g.children.length === EXPRESSION_IDS.length)
                return g;
        return null;
    }

    async function openExpressionTab() {
        let grid = findExpressionGrid();
        if (grid !== null)
            return grid;
        for (const tab of document.querySelectorAll('.tab'))
            if (/xpression/i.test(tab.textContent)) {
                tab.click();
                break;
            }
        for (let i = 0; i < 50 && grid === null; i++) {
            await sleep(100);
            grid = findExpressionGrid();
        }
        return grid;
    }

    function hasPixels(tex) {
        const img = tex.image;
        return !!(img && img.data && img.data.length === img.width * img.height * 4);
    }

    // Mi Creator keeps the face pixels in memory, laid out like the .glb export's face; otherwise read them back from the GPU.
    function readTexture(renderer, tex) {
        const w = tex.image.width, h = tex.image.height;
        let px;
        if (hasPixels(tex))
            px = new Uint8ClampedArray(tex.image.data.buffer, tex.image.data.byteOffset, w * h * 4);
        else
            px = readGPU(renderer, tex, w, h);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
        return canvas.toDataURL('image/png');
    }

    function readGPU(renderer, tex, w, h) {
        const gl = renderer.getContext();
        const webglTexture = renderer.properties.get(tex).__webglTexture;
        const prev = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, webglTexture, 0);
        const ok = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        const px = new Uint8ClampedArray(w * h * 4);
        if (ok)
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
        gl.deleteFramebuffer(fb);
        if (!ok)
            throw new Error('texture illisible');
        return px;
    }

    async function grabAll(cap) {
        const grid = await openExpressionTab();
        if (grid === null)
            throw new Error('Je ne trouve pas la liste des expressions. Ouvre l\'onglet « Expression » puis reclique sur le favori.');
        const items = Array.from(grid.children);
        const startIndex = Math.max(0, items.findIndex((c) => c.classList.contains('active')));
        const faces = {};
        let size = 0;
        for (let i = 0; i < items.length; i++) {
            banner(`Mii Studio : récupération des émotions… ${i + 1} / ${items.length}\nNe touche à rien pendant quelques secondes.`);
            const before = findMask(cap)?.tex;
            items[i].click();
            const t0 = performance.now();
            let mask = findMask(cap);
            while (i !== startIndex && (mask === null || mask.tex === before) && performance.now() - t0 < 4000) {
                await sleep(25);
                mask = findMask(cap);
            }
            await frame();
            await frame();
            mask = findMask(cap);
            if (mask === null)
                throw new Error('visage introuvable');
            faces[String(EXPRESSION_IDS[i])] = readTexture(mask.renderer, mask.tex);
            size = mask.tex.image.width;
        }
        items[startIndex].click();
        return { faces, size };
    }

    function miiName() {
        const input = document.querySelector('input[name="name"], input#name');
        const name = (input && input.value) || window.__miiStudioName || 'Mii';
        return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'Mii';
    }

    async function main() {
        if (!/(^|\.)nxw\.pw$/.test(location.hostname)) {
            banner('Ce favori s\'utilise sur Mi Creator : https://mii.nxw.pw/app', true);
            return;
        }
        const firstRun = window.__miiStudioCapture === undefined;
        const cap = installHook();
        if (window.__miiStudioBusy)
            return;
        if (findMask(cap) === null || document.querySelector('.feature-set-group') === null) {
            banner(firstRun || document.querySelector('.feature-set-group') === null
                ? 'Mii Studio est prêt ✔\n\n1. Clique sur ton Mii → « Rendu » → « Rendu personnalisé ».\n2. Quand le Mii est affiché, reclique sur le favori.\n\n(Si le rendu personnalisé était déjà ouvert, ferme-le et rouvre-le.)'
                : 'Ferme le « Rendu personnalisé », rouvre-le, puis reclique sur le favori.');
            return;
        }
        window.__miiStudioBusy = true;
        try {
            const { faces, size } = await grabAll(cap);
            const name = miiName();
            const file = { type: 'mii-studio-emotions', version: 1, name, size, faces };
            const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
            if (window.__miiStudioDryRun) {
                window.__miiStudioResult = file;
                banner(`Test : ${Object.keys(faces).length} émotions, ${Math.round(blob.size / 1e6)} Mo.`, true);
                return;
            }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${name}_emotions.miiemo`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 60000);
            banner(`✔ ${Object.keys(faces).length} émotions enregistrées dans « ${a.download} ».\nDans Mii Studio, sélectionne ce Mii puis « Importer toutes les émotions ».`, true);
        } catch (e) {
            banner(`Mii Studio : échec (${e && e.message ? e.message : e}).`, true);
        } finally {
            window.__miiStudioBusy = false;
        }
    }

    main();
})();
