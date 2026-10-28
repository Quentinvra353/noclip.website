
import { mat4, vec3, vec4 } from 'gl-matrix';
import { fullscreenMegaState } from '../gfx/helpers/GfxMegaStateDescriptorHelpers.js';
import { GfxShaderLibrary } from '../gfx/helpers/GfxShaderLibrary.js';
import { GfxBindingLayoutDescriptor, GfxClipSpaceNearZ, GfxDevice, GfxFormat, GfxMipFilterMode, GfxPlatform, GfxPrimitiveTopology, GfxProgram, GfxReadback, GfxSampler, GfxSamplerFormatKind, GfxTexFilterMode, GfxTextureDimension, GfxWrapMode } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache.js';
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription, GfxrRenderTargetID, gfxrRenderGraphHooks } from '../gfx/render/GfxRenderGraph.js';
import { preprocessProgram_GLSL } from '../gfx/shaderc/GfxShaderCompiler.js';
import type { Viewer } from '../viewer.js';

// A low-resolution copy of the scene's depth buffer, read back to the CPU, so the Miis can be
// placed on the scenery and their shadows kept on real ground.
export interface DepthSnapshot {
    width: number;
    height: number;
    // Raw depth per pixel (reversed: 0 is the far plane / sky), bottom row first.
    depth: Float32Array;
    clipFromWorld: mat4;
    worldFromClip: mat4;
    // Clip-space depth convention of the device: 0 means z = d, 1 means z = 2d - 1.
    nearZNegativeOne: boolean;
    serial: number;
}

interface InFlight {
    readback: GfxReadback;
    width: number;
    height: number;
    clipFromWorld: mat4;
}

const DOWNSCALE = 2;
const bindingLayouts: GfxBindingLayoutDescriptor[] = [{
    numUniformBuffers: 0, numSamplers: 1,
    samplerEntries: [{ dimension: GfxTextureDimension.n2D, formatKind: GfxSamplerFormatKind.UnfilterableFloat }],
}];

export class DepthCapture {
    public snapshot: DepthSnapshot | null = null;
    public readonly supported: boolean;
    private cache: GfxRenderCache;
    private program: GfxProgram;
    private sampler: GfxSampler;
    private colorTargetDesc = new GfxrRenderTargetDescription(GfxFormat.U32_R);
    private inFlight: InFlight[] = [];
    private pool: GfxReadback[] = [];
    private poolByteSize = 0;
    private serial = 0;
    private capturedThisFrame = false;
    private nearZNegativeOne: boolean;

    constructor(private device: GfxDevice, private viewer: Viewer) {
        const vendorInfo = device.queryVendorInfo();
        this.supported = vendorInfo.platform === GfxPlatform.WebGL2 && device.readPixelsFromTexture !== undefined;
        this.nearZNegativeOne = vendorInfo.clipSpaceNearZ === GfxClipSpaceNearZ.NegativeOne;
        this.cache = new GfxRenderCache(device);
        const fs = `
uniform sampler2D u_TextureFramebufferDepth;
in vec2 v_TexCoord;
out uint o_Output;
void main() {
    o_Output = uint(texture(SAMPLER_2D(u_TextureFramebufferDepth), v_TexCoord).r * 4294967295.0);
}
`;
        this.program = this.cache.createProgramSimple(preprocessProgram_GLSL(vendorInfo, GfxShaderLibrary.fullscreenVS, fs));
        this.sampler = this.cache.createSampler({
            minFilter: GfxTexFilterMode.Point, magFilter: GfxTexFilterMode.Point, mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp, wrapT: GfxWrapMode.Clamp, minLOD: 0, maxLOD: 100,
        });
        if (this.supported)
            gfxrRenderGraphHooks.onExecuteMainGraph = this.onExecuteMainGraph;
    }

    private onExecuteMainGraph = (builder: GfxrGraphBuilder, depthTargetID: GfxrRenderTargetID): void => {
        this.poll();
        // Several graphs can run per frame; capture at most one, and keep few readbacks in flight.
        if (this.capturedThisFrame || this.inFlight.length >= 3)
            return;
        this.capturedThisFrame = true;
        const depthDesc = builder.getRenderTargetDescription(depthTargetID);
        const width = Math.max(1, Math.floor(depthDesc.width / DOWNSCALE)), height = Math.max(1, Math.floor(depthDesc.height / DOWNSCALE));
        const readback = this.getReadback(width * height * 4);
        const clipFromWorld = mat4.clone(this.viewer.camera.clipFromWorldMatrix);

        this.colorTargetDesc.setDimensions(width, height, 1);
        const colorTargetID = builder.createRenderTargetID(this.colorTargetDesc, 'MiiStudio Depth Copy');
        builder.pushPass((pass) => {
            pass.setDebugName('MiiStudio Depth Copy');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, colorTargetID);
            const depthTextureID = builder.resolveRenderTarget(depthTargetID);
            pass.attachResolveTexture(depthTextureID);
            pass.addExtraRef(GfxrAttachmentSlot.Color0);
            pass.exec((passRenderer, scope) => {
                const pipeline = this.cache.createRenderPipeline({
                    bindingLayouts, inputLayout: null, program: this.program,
                    topology: GfxPrimitiveTopology.Triangles, megaStateDescriptor: fullscreenMegaState,
                    colorAttachmentFormats: [GfxFormat.U32_R], depthStencilAttachmentFormat: null, sampleCount: 1,
                });
                this.device.pipelineForceReady(pipeline);
                const bindings = this.cache.createBindings({
                    bindingLayout: bindingLayouts[0], uniformBufferBindings: [],
                    samplerBindings: [{ gfxTexture: scope.getResolveTextureForID(depthTextureID), gfxSampler: this.sampler }],
                });
                passRenderer.setPipeline(pipeline);
                passRenderer.setVertexInput(null, null, null);
                passRenderer.setBindings(0, bindings, []);
                passRenderer.draw(3, 0);
            });
            pass.post((scope) => {
                const texture = scope.getRenderTargetTexture(GfxrAttachmentSlot.Color0);
                if (texture === null)
                    return;
                this.device.readPixelsFromTexture!(readback, 0, texture, 0, 0, width, height);
                this.device.submitReadback(readback);
                this.inFlight.push({ readback, width, height, clipFromWorld });
            });
        });
    };

    // Called once per frame, after the scene rendered.
    public endFrame(): void {
        this.capturedThisFrame = false;
        this.poll();
    }

    private getReadback(byteSize: number): GfxReadback {
        if (byteSize !== this.poolByteSize) {
            for (const r of this.pool)
                this.device.destroyReadback(r);
            this.pool.length = 0;
            this.poolByteSize = byteSize;
        }
        return this.pool.pop() ?? this.device.createReadback(byteSize);
    }

    private releaseReadback(r: GfxReadback, byteSize: number): void {
        if (byteSize === this.poolByteSize)
            this.pool.push(r);
        else
            this.device.destroyReadback(r);
    }

    // Collect finished readbacks; the newest one becomes the snapshot.
    public poll(): void {
        for (let i = 0; i < this.inFlight.length; i++) {
            const f = this.inFlight[i];
            const raw = new Uint32Array(f.width * f.height);
            if (!this.device.queryReadbackFinished(raw, 0, f.readback))
                continue;
            this.inFlight.splice(i--, 1);
            this.releaseReadback(f.readback, f.width * f.height * 4);
            const depth = new Float32Array(raw.length);
            for (let j = 0; j < raw.length; j++)
                depth[j] = raw[j] / 0xFFFFFFFF;
            this.snapshot = {
                width: f.width, height: f.height, depth,
                clipFromWorld: f.clipFromWorld, worldFromClip: mat4.invert(mat4.create(), f.clipFromWorld),
                nearZNegativeOne: this.nearZNegativeOne, serial: ++this.serial,
            };
        }
    }

    private tmp = vec4.create();
    private tmpGround = vec4.create();

    // World position of the scenery seen at normalized device coordinates (x, y), or null for sky / nothing.
    public pick(dst: vec3, ndcX: number, ndcY: number): boolean {
        const s = this.snapshot;
        if (s === null)
            return false;
        const px = Math.floor((ndcX * 0.5 + 0.5) * s.width), py = Math.floor((ndcY * 0.5 + 0.5) * s.height);
        if (px < 0 || py < 0 || px >= s.width || py >= s.height)
            return false;
        const d = s.depth[py * s.width + px];
        if (d <= 0)
            return false;
        const t = this.tmp;
        vec4.set(t, ndcX, ndcY, s.nearZNegativeOne ? d * 2 - 1 : d, 1);
        vec4.transformMat4(t, t, s.worldFromClip);
        vec3.set(dst, t[0] / t[3], t[1] / t[3], t[2] / t[3]);
        return true;
    }

    private pixelToWorld(dst: vec3, s: DepthSnapshot, px: number, py: number): boolean {
        if (px < 0 || py < 0 || px >= s.width || py >= s.height)
            return false;
        const d = s.depth[py * s.width + px];
        if (d <= 0)
            return false;
        const t = this.tmp;
        vec4.set(t, (px + 0.5) / s.width * 2 - 1, (py + 0.5) / s.height * 2 - 1, s.nearZNegativeOne ? d * 2 - 1 : d, 1);
        vec4.transformMat4(t, t, s.worldFromClip);
        vec3.set(dst, t[0] / t[3], t[1] / t[3], t[2] / t[3]);
        return true;
    }

    // How much the surface seen at (x, y) faces up: 1 for flat ground, 0 for a wall. Null if unknown.
    public surfaceUpness(ndcX: number, ndcY: number): number | null {
        const s = this.snapshot;
        if (s === null)
            return null;
        const px = Math.floor((ndcX * 0.5 + 0.5) * s.width), py = Math.floor((ndcY * 0.5 + 0.5) * s.height);
        const a = vec3.create(), b = vec3.create(), c = vec3.create(), d = vec3.create();
        if (!this.pixelToWorld(a, s, px - 1, py) || !this.pixelToWorld(b, s, px + 1, py) || !this.pixelToWorld(c, s, px, py - 1) || !this.pixelToWorld(d, s, px, py + 1))
            return null;
        const n = vec3.cross(vec3.create(), vec3.sub(b, b, a), vec3.sub(d, d, c));
        const len = vec3.length(n);
        return len > 0 ? Math.abs(n[1]) / len : null;
    }

    // Where the scenery is below a point: walks down from it, looking for the first spot hidden by a surface.
    public findGroundBelow(x: number, y: number, z: number, maxDrop: number, radius: number): number | null {
        const s = this.snapshot;
        if (s === null)
            return null;
        const steps = 200, t = this.tmp;
        let wasInFront = false;
        for (let i = 0; i <= steps; i++) {
            const py = y - maxDrop * i / steps;
            vec4.set(t, x, py, z, 1);
            vec4.transformMat4(t, t, s.clipFromWorld);
            if (t[3] <= 0)
                return null;
            const nx = t[0] / t[3], ny = t[1] / t[3];
            const ix = Math.floor((nx * 0.5 + 0.5) * s.width), iy = Math.floor((ny * 0.5 + 0.5) * s.height);
            if (ix < 0 || iy < 0 || ix >= s.width || iy >= s.height)
                return null;
            const pointDepth = s.nearZNegativeOne ? (t[2] / t[3] + 1) / 2 : t[2] / t[3];
            const sceneDepth = s.depth[iy * s.width + ix];
            // Reversed depth: bigger is closer. The point goes behind the scenery when it crosses the ground.
            const inFront = pointDepth >= sceneDepth;
            if (i > 0 && wasInFront && !inFront) {
                // Make sure it's really the ground under the point, not something in front hiding it.
                const g = this.tmpGround;
                vec4.set(g, nx, ny, s.nearZNegativeOne ? sceneDepth * 2 - 1 : sceneDepth, 1);
                vec4.transformMat4(g, g, s.worldFromClip);
                const gx = g[0] / g[3], gy = g[1] / g[3], gz = g[2] / g[3];
                if (Math.hypot(gx - x, gz - z) <= radius)
                    return gy;
                return null;
            }
            wasInFront = inFront;
        }
        return null;
    }

    public destroy(): void {
        if (gfxrRenderGraphHooks.onExecuteMainGraph === this.onExecuteMainGraph)
            gfxrRenderGraphHooks.onExecuteMainGraph = null;
        for (const f of this.inFlight)
            this.device.destroyReadback(f.readback);
        for (const r of this.pool)
            this.device.destroyReadback(r);
        this.inFlight.length = 0;
        this.pool.length = 0;
        this.cache.destroy();
    }
}
