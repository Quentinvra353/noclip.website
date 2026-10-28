
export const enum MiiGender { Male = 0, Female = 1 }

export interface MiiInfo {
    // Hex string passed to the renderer server as `data=`.
    rendererData: string;
    gender: MiiGender;
    favoriteColor: number;
    // 0-127, as stored in the Mii data.
    height: number;
    build: number;
    format: string;
}

// FFL favorite colors, used for the shirt.
export const FAVORITE_COLORS = [
    0xD21E14, 0xFF6E19, 0xFFD820, 0x78D220, 0x007830, 0x0A48B4,
    0x3CAADE, 0xF55A7D, 0x7328AD, 0x483818, 0xE0E0E0, 0x181814,
];

export const FAVORITE_COLOR_NAMES = [
    'Rouge', 'Orange', 'Jaune', 'Vert clair', 'Vert', 'Bleu',
    'Bleu ciel', 'Rose', 'Violet', 'Marron', 'Blanc', 'Noir',
];

function bytesToHex(b: Uint8Array): string {
    return Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
}

function parseTextToBytes(text: string): Uint8Array | null {
    const s = text.trim();
    if (s.length === 0)
        return null;

    // Allow a full renderer URL, e.g. "https://.../miis/image.png?data=...".
    const urlMatch = s.match(/[?&]data=([^&\s]+)/);
    if (urlMatch !== null)
        return parseTextToBytes(decodeURIComponent(urlMatch[1]));

    const hex = s.replace(/[\s:-]/g, '');
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++)
            out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return out;
    }

    try {
        const b64 = s.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++)
            out[i] = bin.charCodeAt(i);
        return out;
    } catch (e) {
        return null;
    }
}

function decodeStudio(b: Uint8Array): Uint8Array {
    // 47-byte obfuscated studio data, as used in studio.mii.nintendo.com URLs.
    const out = new Uint8Array(46);
    for (let i = 0; i < 46; i++)
        out[i] = (((b[i + 1] - 7) & 0xFF) ^ b[i]) & 0xFF;
    return out;
}

function infoFromStudio(raw: Uint8Array, format: string): MiiInfo {
    return {
        rendererData: bytesToHex(raw),
        favoriteColor: raw[21] % 12,
        gender: raw[22] === 1 ? MiiGender.Female : MiiGender.Male,
        height: raw[30],
        build: raw[2],
        format,
    };
}

export function parseMiiData(input: Uint8Array | string): MiiInfo {
    const b = typeof input === 'string' ? parseTextToBytes(input) : input;
    if (b === null || b.length === 0)
        throw new Error(`Données Mii illisibles.`);

    const hex = bytesToHex(b);

    if (b.length === 46)
        return infoFromStudio(b, 'Studio');
    if (b.length === 47)
        return infoFromStudio(decodeStudio(b), 'Studio (encodé)');

    // 3DS / Wii U (CFSD / FFSD, with or without the trailing checksum).
    if (b.length === 92 || b.length === 96) {
        const flags = b[0x18] | (b[0x19] << 8);
        const height = b[0x2E], build = b[0x2F];
        return {
            rendererData: hex,
            gender: (flags & 1) ? MiiGender.Female : MiiGender.Male,
            favoriteColor: ((flags >>> 10) & 0x0F) % 12,
            height, build,
            format: '3DS / Wii U',
        };
    }

    // Switch CharInfo.
    if (b.length === 88) {
        return {
            rendererData: hex,
            favoriteColor: b[0x27] % 12,
            gender: b[0x28] === 1 ? MiiGender.Female : MiiGender.Male,
            height: b[0x29], build: b[0x2A],
            format: 'Switch',
        };
    }

    // Wii (RFL), big-endian.
    if (b.length === 74 || b.length === 76) {
        const flags = (b[0] << 8) | b[1];
        return {
            rendererData: hex,
            gender: (flags & 0x4000) ? MiiGender.Female : MiiGender.Male,
            favoriteColor: ((flags >>> 1) & 0x0F) % 12,
            height: b[0x16], build: b[0x17],
            format: 'Wii',
        };
    }

    // Unknown format; let the renderer server try to make sense of it.
    return { rendererData: hex, gender: MiiGender.Male, favoriteColor: 0, height: 64, build: 64, format: `inconnu (${b.length} octets)` };
}
