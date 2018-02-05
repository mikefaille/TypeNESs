﻿/*
Copyright (C) 2017 Charlie Lee

TypeNESs has referred to Ben Firshman's JSNES
https://github.com/bfirsh/jsnes

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import { MIRRORING_TYPE } from "./ROM";
import { IRQType } from "./CPU";
import { Machine } from "./Machine";

enum PPU_STATUS {
    STATUS_SPRITE0HIT = 6,
    STATUS_VBLANK = 7,
}

export class Tile {
    public static backgroundColor: number;                          // background color
    public pixels: number[];
    constructor() {
        this.pixels = new Array(64);
        for (let i = 0; i < 64; i++) {
            this.pixels[i] = 0;
        }
    }
    public setScanline(sline: number, byte1: number, byte2: number) {                       // Tile data comes from pattern table, and each line of the tile is combined by two bytes
        const tIndex = sline << 3;
        for (let x = 0; x < 8; x++) {
            this.pixels[tIndex + x] = ((byte1 >> (7 - x)) & 1) +       //  Each bit in the first byte determines the lower bit of this pixel
                (((byte2 >> (7 - x)) & 1) << 1);                    //  Each bit in the second byte determines the higher bit of the pixel
        }
    }

    //  Render the tile to the canvas at the location of (destX,destY)
    //
    public render(
        buffer: number[],                   // Buffer to be drawn on the canvas
        srcx1: number,                      //  Beginning x of the 8x8 tile
        srcy1: number,                      //  Beginning y of the 8x8 tile
        srcx2: number,                      //  End x of the 8x8 tile
        srcy2: number,                      //  End x of the 8x8 tile
        destX: number,                      //  X position of the canvas
        destY: number,                      //  Y position of the canvas
        palAdd: number,                     //  The higher two bits of a pixel
        palette: Palette,                   //  palette to be used
        flipHorizontal: boolean,            //  Draw tile with horizontal flip
        flipVertical: boolean,              //  Draw tile with vertical flip
        behindBackground: boolean           //  Draw tile behind background. Still visible if there's no background
    ) {

        if (destX < -7 || destX >= 256 || destY < -7 || destY >= 240) {
            return;
        }

        if (destX < 0) {                                           // destX is less than 0 means only part of the tile will be placed on the canvas
            srcx1 -= destX;                                        //  so we need to increase srcx1 to draw only what's needed.
        }
        if (destX + srcx2 >= 256) {
            srcx2 = 256 - destX;
        }

        if (destY < 0) {
            srcy1 -= destY;
        }
        if (destY + srcy2 >= 240) {
            srcy2 = 240 - destY;
        }

        let canvasIndex: number = (destY << 8) + destX;         //  Indicates which pixel occupy on canvas
        let palIndex: number = 0;                               //  The lower 2 bits of the palette, which is also the array member value of the this.pix
        let tIndex = 0;                                         //  tIndex is the tile index for this.pix array
        let tIndexStepInc: number = 0;
        let tIndexLineInc: number = 0;

        if (!flipHorizontal && !flipVertical) {
            tIndex = 0;
            tIndexStepInc = 1;
            tIndexLineInc = 0;
        } else if (flipHorizontal && !flipVertical) {
            tIndex = 7;
            tIndexStepInc = -1;
            tIndexLineInc = 16;
        } else if (!flipHorizontal && flipVertical) {
            tIndex = 56;
            tIndexStepInc = 1;
            tIndexLineInc = -16;
        } else {
            tIndex = 63;
            tIndexStepInc = -1;
            tIndexLineInc = 0;
        }

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
                    palIndex = this.pixels[tIndex];
                    if ((palIndex !== 0) && (!((buffer[canvasIndex] !== Tile.backgroundColor) && behindBackground))) {// && pri <= (tpri & 0xFF)) {         // pri is the index of the sprite tile. The smaller it is, the higher priority is has to be displayed on screen
                        buffer[canvasIndex] = palette.RGBColors[palIndex + palAdd];
                    }
                }
                canvasIndex++;
                tIndex += tIndexStepInc;
            }
            canvasIndex -= 8;
            canvasIndex += 256;
            tIndex += tIndexLineInc;
        }
    }
}

class Nametable {
    private indexes: number[];
    private attrib: number[];                           //  At the end of each nametable in the PPU mem, every two bits stores the palette higher 2 bits for a 2x2 tile area

    constructor() {
        this.indexes = new Array(960);
        for (let i = 0; i < 960; i++) {
            this.indexes[i] = 0;
        }
        this.attrib = new Array(960);
    }

    public setByte(index: number, value: number) {
        this.indexes[index] = value;
    }

    public getTileIndex(rowX: number, rowY: number) {
        return this.indexes[(rowY << 5) + rowX];
    }

    public getAttrib(x: number, y: number) {
        return this.attrib[y * 32 + x];
    }

    public writeAttrib(
        index: number,                                              // the offset address from 0x3c0.
        value: number
    ) {
        const basex = (index % 8) * 4;                            // Every attribute byte covers 4x(2x2)=16 tiles
        const basey = Math.floor(index / 8) * 4;
        let add;
        let tx, ty;
        let attindex;

        for (let sqy = 0; sqy < 2; sqy++) {
            for (let sqx = 0; sqx < 2; sqx++) {
                add = (value >> (2 * (sqy * 2 + sqx))) & 3;
                for (let y = 0; y < 2; y++) {
                    for (let x = 0; x < 2; x++) {
                        tx = basex + sqx * 2 + x;
                        ty = basey + sqy * 2 + y;
                        attindex = ty * 32 + tx;
                        this.attrib[ty * 32 + tx] = (add << 2) & 12;
                    }
                }
            }
        }
    }
}

class AttrTable {
    private indexes: number[];
    constructor() {
        this.indexes = new Array(960);
        for (let i = 0; i < 960; i++) {
            this.indexes[i] = 0;
        }
    }

    //  ,---+---+---+---.
    //  |   |   |   |   |
    //  + D1 - D0 + D3 - D2 +
    //  |   |   |   |   |
    //  +---+---+---+---+
    //  |   |   |   |   |
    //  + D5 - D4 + D7 - D6 +
    //  |   |   |   |   |
    //  `---+---+---+---'
    public setByte(index: number, value: number) {
        const i = index * 16;
        const topleft = value & 3;
        const topright = (value >> 2) & 3;
        const btmleft = (value >> 4) & 3;
        const btmright = (value >> 6) & 3;

        this.indexes[i] = topleft;
        this.indexes[i + 1] = topleft;
        this.indexes[i + 32] = topleft;
        this.indexes[i + 32 + 1] = topleft;

        this.indexes[i + 2] = topright;
        this.indexes[i + 3] = topright;
        this.indexes[i + 32 + 2] = topright;
        this.indexes[i + 32 + 3] = topright;

        this.indexes[i + 64] = btmleft;
        this.indexes[i + 64 + 1] = btmleft;
        this.indexes[i + 96] = btmleft;
        this.indexes[i + 96 + 1] = btmleft;

        this.indexes[i + 64 + 2] = btmright;
        this.indexes[i + 64 + 3] = btmright;
        this.indexes[i + 96 + 2] = btmright;
        this.indexes[i + 96 + 3] = btmright;
    }

    public getAttr(rowX: number, rowY: number): number {
        return this.indexes[(rowY << 5) + rowX];
    }
}

class Palette {
    public RGBColors: number[];
    constructor() {
        this.RGBColors = new Array(16);
        for (let i = 0; i < 16; i++) {
            this.RGBColors[i] = 0;
        }
    }
    public static NTSCRGBColors = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000];
}

export class PPU {
    private curX: number;
    private curScanline: number;

    public screenBuffer: number[];
    public prevScreenBuffer: number[];

    // PPUCTRL $2000:
    private PPUCTRL_NMIEnable: boolean;
    private PPUCTRL_PPUMaster: boolean;
    private PPUCTRL_SpriteHeight: boolean;
    private PPUCTRL_BackgroundTileSelect: boolean;
    private PPUCTRL_SpriteTileSelect: boolean;
    private PPUCTRL_IncrementMode: boolean;
    private PPUCTRL_NameTableSelect: number;
    private PPUCTRL_CntNameTableSelect: number;

    //  PPUMASK $2001
    private PPUMASK_BGR: number;
    private PPUMASK_SpriteEnable: boolean;
    private PPUMASK_BackgroundEnable: boolean;
    private PPUMASK_SpriteLeftColumnEnable: boolean;
    private PPUMASK_BackgroundLeftColumnEnable: boolean;
    private PPUMASK_GREYSCALE: boolean;

    //  PPUSTATUS $2002
    private PPUSTATUS_VBlank: boolean;
    private PPUSTATUS_Sprite0Hit: boolean;
    private PPUSTATUS_SpriteOverflow: boolean;
    private PPUSTATUS_PPUAddrLatch: boolean;
    private PPUSTATUS_Sprite0HitX: number;
    private PPUSTATUS_Sprite0HitY: number;

    public sprX: number[];                      //  X position for sprite RAM
    private sprY: number[];                     //  Y position for sprite RAM
    private sprTile: number[];                  //  Stores the sprite tile data.
    private sprCol: number[];                   //  Upper two bits of color
    private sprVertFlip: boolean[];
    private sprHoriFlip: boolean[];
    private sprBehindBackground: boolean[];     //  true: in front of background

    //  SPRITERAM $2003
    private OAMAddr: number;
    private OAMData: number[];

    //  PPUSCROLL $2005
    //  The four reigsters specify top left screen tile
    private CoarseXScroll: number;
    private CoarseYScroll: number;
    private FineXScroll: number;
    private FineYScroll: number;

    //  Address that changes as scanline increases, reset by frame
    private CntCoarseXScroll: number;
    private CntCoarseYScroll: number;
    private CntFineXScroll: number;
    private CntFineYScroll: number;

    //  PPUADDR $2006
    private PPUAddr: number;

    //  $2007
    private readValueBuffer: number;

    public PPURAM: number[];
    private mirroringType: MIRRORING_TYPE;
    private VRAMMirroringMap: number[];
    private nametableMapper: number[];
    public tiles: Tile[];
    private tileIndexCache: number[];
    private tileIndexCacheValid: boolean;
    private tileAttrCache: number[];

    public nametables: Nametable[];
    public attrTables: AttrTable[];
    public palettes: Palette[];

    private machine: Machine;
    constructor(nesMachine: Machine) {
        this.machine = nesMachine;
        this.reset();
    }

    public reset() {
        this.curX = 0;
        this.curScanline = 0;
        this.screenBuffer = new Array(256 * 240);
        for (let i = 0; i < 256 * 240; i++) {
            this.screenBuffer[i] = 0;
        }

        this.prevScreenBuffer = new Array(256 * 240);
        for (let i = 0; i < 256 * 240; i++) {
            this.prevScreenBuffer[i] = 0;
        }

        this.PPUCTRL_NMIEnable = false;
        this.PPUCTRL_PPUMaster = false;
        this.PPUCTRL_SpriteHeight = false;
        this.PPUCTRL_BackgroundTileSelect = false;
        this.PPUCTRL_SpriteTileSelect = false;
        this.PPUCTRL_IncrementMode = false;
        this.PPUCTRL_NameTableSelect = 0;

        this.PPUMASK_BGR = 0;
        this.PPUMASK_SpriteEnable = false;
        this.PPUMASK_BackgroundEnable = false;
        this.PPUMASK_SpriteLeftColumnEnable = false;
        this.PPUMASK_BackgroundLeftColumnEnable = false;
        this.PPUMASK_GREYSCALE = false;

        this.PPUSTATUS_VBlank = false;
        this.PPUSTATUS_Sprite0Hit = false;
        this.PPUSTATUS_Sprite0HitX = -1;
        this.PPUSTATUS_Sprite0HitY = -1;

        this.PPUSTATUS_SpriteOverflow = false;
        this.PPUSTATUS_PPUAddrLatch = false;

        this.PPUAddr = 0;

        this.OAMAddr = 0;
        this.OAMData = new Array(256);

        this.PPURAM = new Array(0x4000);
        for (let i = 0; i < 0x4000; i++) {
            this.PPURAM[i] = 0;
        }

        this.mirroringType = undefined;

        this.tiles = new Array(512);
        for (let i = 0; i < 512; i++) {
            this.tiles[i] = new Tile();
        }

        this.tileIndexCache = new Array(32);
        this.tileAttrCache = new Array(32);
        this.tileIndexCacheValid = false;

        this.nametables = new Array(4);
        for (let i = 0; i < 4; i++) {
            this.nametables[i] = new Nametable();
        }

        this.attrTables = new Array(4);
        for (let i = 0; i < 4; i++) {
            this.attrTables[i] = new AttrTable();
        }

        this.palettes = new Array(2);
        this.palettes[0] = new Palette();
        this.palettes[1] = new Palette();
        this.nametableMapper = new Array(4);

        // Sprite data:
        this.sprX = new Array(64); // X coordinate
        this.sprY = new Array(64); // Y coordinate
        this.sprTile = new Array(64); // Tile Index (into pattern table)
        this.sprCol = new Array(64); // Upper two bits of color
        this.sprVertFlip = new Array(64); // Vertical Flip
        this.sprHoriFlip = new Array(64); // Horizontal Flip
        this.sprBehindBackground = new Array(64); // true: behind background
    }

    public writePPUCTRL$2000(value: number) {
        this.PPUCTRL_NMIEnable = ((value >> 7) & 1) != 0 ? true : false;
        this.PPUCTRL_PPUMaster = ((value >> 6) & 1) != 0 ? true : false;
        this.PPUCTRL_SpriteHeight = ((value >> 5) & 1) != 0 ? true : false;
        this.PPUCTRL_BackgroundTileSelect = ((value >> 4) & 1) != 0 ? true : false;
        this.PPUCTRL_SpriteTileSelect = ((value >> 3) & 1) != 0 ? true : false;
        this.PPUCTRL_IncrementMode = ((value >> 2) & 1) != 0 ? true : false;
        this.PPUCTRL_NameTableSelect = (value & 3);
    }

    public writePPUMASK$2001(value: number) {
        this.PPUMASK_BGR = (value >> 5) & 0x7;
        this.PPUMASK_SpriteEnable = ((value >> 4) & 1) != 0 ? true : false;
        this.PPUMASK_BackgroundEnable = ((value >> 3) & 1) != 0 ? true : false;
        this.PPUMASK_SpriteLeftColumnEnable = ((value >> 2) & 1) != 0 ? true : false;
        this.PPUMASK_BackgroundLeftColumnEnable = ((value >> 1) & 1) != 0 ? true : false;
        this.PPUMASK_GREYSCALE = (value & 1) != 0 ? true : false;
    }

    public writePPUSTATUS$2002(value: number) {
        this.PPUSTATUS_VBlank = ((value >> 7) & 1) != 0 ? true : false;
        this.PPUSTATUS_Sprite0Hit = ((value >> 6) & 1) != 0 ? true : false;
        this.PPUSTATUS_SpriteOverflow = ((value >> 5) & 1) != 0 ? true : false;
    }

    public readPPUSTATUS$2002(): number {
        const ret: number = this.machine.cpu.mem[0x2002];
        this.PPUSTATUS_PPUAddrLatch = false;
        this.setStatusFlag(PPU_STATUS.STATUS_VBLANK, false);
        return ret;
    }

    public writeOAMADDR$2003(value: number) {
        this.OAMAddr = value & 0xff;
    }

    public readOAMADDR$2003(): number {
        return this.OAMAddr;
    }

    public readOAMData$2004(): number {
        return this.OAMData[this.OAMAddr];
    }

    public writeOAMData$2004(value: number) {
        this.OAMData[this.OAMAddr] = (value & 0xff);
        this.spriteRamWriteUpdate(this.OAMAddr, value & 0xff);
        this.OAMAddr++;
        this.OAMAddr %= 0x100;
    }

    public writePPUScroll$2005(value: number) {
        if (!this.PPUSTATUS_PPUAddrLatch) {
            this.FineXScroll = (value & 7);
            this.CoarseXScroll = (value >> 3) & 0x1f;
        } else {
            this.FineYScroll = value & 7;
            this.CoarseYScroll = (value >> 3) & 0x1f;
        }

        this.PPUSTATUS_PPUAddrLatch = !this.PPUSTATUS_PPUAddrLatch;
    }

    public writePPUADDR$2006(value: number) {
        if (!this.PPUSTATUS_PPUAddrLatch) {
            this.FineYScroll = (value >> 4) & 7;
            this.PPUCTRL_NameTableSelect = (value >> 2) & 3;
            this.CoarseYScroll = ((value & 3) << 3);
        } else {
            this.CoarseYScroll = (this.CoarseYScroll & 0x18) | ((value >> 5) & 7);
            this.CoarseXScroll = value & 0x1f;

            if (!this.PPUSTATUS_VBlank && this.CoarseXScroll > 0 && ((value & 31) == 0)) {
                console.log("wrong address");
            }
        }
        this.PPUSTATUS_PPUAddrLatch = !this.PPUSTATUS_PPUAddrLatch;
        this.scrollVarsToAddress();
    }

    private scrollVarsToAddress() {
        let leftByte = (this.FineYScroll & 7) << 4;
        leftByte |= (this.PPUCTRL_NameTableSelect & 3) << 2;
        leftByte |= (this.CoarseYScroll >> 3) & 3;

        let rightByte = (this.CoarseYScroll & 7) << 5;
        rightByte |= this.CoarseXScroll & 31;

        this.PPUAddr = ((leftByte << 8) | rightByte) & 0x7FFF;
    }

    private addressToScrollVars() {
        const leftByte = (this.PPUAddr >> 8) & 0xFF;
        this.FineYScroll = (leftByte >> 4) & 7;
        this.PPUCTRL_NameTableSelect = (leftByte >> 2) & 3;
        this.CoarseYScroll = (leftByte & 3) << 3;

        const rightByte = this.PPUAddr & 0xFF;
        this.CoarseYScroll = (this.CoarseYScroll & 24) | ((rightByte >> 5) & 7);
        this.CoarseXScroll = this.PPUAddr & 31;
    }

    public readPPUData$2007(): number {
        let ret: number = 0;

        this.scrollVarsToAddress();

        // If address is in range 0x0000-0x3EFF, return buffered values:
        if (this.PPUAddr <= 0x3EFF) {
            ret = this.readValueBuffer;

            // Update buffered value:
            if (this.PPUAddr < 0x2000) {
                this.readValueBuffer = this.PPURAM[this.PPUAddr];
            }
            else {
                this.readValueBuffer = this.PPURAM[this.VRAMMirroringMap[this.PPUAddr]];
            }

            // Increment by either 1 or 32, depending on d2 of Control Register 1:
            this.PPUAddr += (this.PPUCTRL_IncrementMode ? 32 : 1);

            this.addressToScrollVars();

            return ret; // Return the previous buffered value.
        }

        ret = this.PPURAM[this.VRAMMirroringMap[this.PPUAddr]];
        if (this.PPUCTRL_IncrementMode) {
            this.PPUAddr += 32;
        } else {
            this.PPUAddr++;
        }
        this.addressToScrollVars();
        return ret;
    }

    public writePPUData$2007(value: number) {
        this.PPURAM[this.PPUAddr] = value;
        this.writePPUData(this.PPUAddr, value);
        if (this.PPUCTRL_IncrementMode) {
            this.PPUAddr += 32;
        } else {
            this.PPUAddr++;
        }
        this.addressToScrollVars();
    }

    private writePPUData(addr: number, value: number) {
        if (this.PPUAddr < 0x2000) {
            this.updateTileHelper(addr, value);
        } else if (addr < 0x23c0) {
            this.nametables[this.getRealNametableNo(0)].setByte(addr - 0x2000, value);
        } else if (addr < 0x2400) {
            this.nametables[this.nametableMapper[0]].writeAttrib(addr - 0x23c0, value);
        } else if (addr < 0x27c0) {
            this.nametables[this.getRealNametableNo(1)].setByte(addr - 0x2400, value);
        } else if (addr < 0x2800) {
            this.nametables[this.nametableMapper[1]].writeAttrib(addr - 0x27c0, value);
        } else if (addr < 0x2bc0) {
            this.nametables[this.getRealNametableNo(2)].setByte(addr - 0x2800, value);
        } else if (addr < 0x2c00) {
            this.nametables[this.nametableMapper[2]].writeAttrib(addr - 0x2bc0, value);
        } else if (addr < 0x2fc0) {
            this.nametables[this.getRealNametableNo(3)].setByte(addr - 0x2c00, value);
        } else if (addr < 0x3000) {
            this.nametables[this.nametableMapper[3]].writeAttrib(addr - 0x2fc0, value);
        } else if (addr < 0x3f00) {
            this.writePPUData(addr - 0x1000, value);
        } else if (addr < 0x3f20) {
            this.PaletteRAMWriteMirror(addr, value);
            this.updatePalettes();
        } else {
            this.writePPUData(0x3f00 + ((addr - 0x3f00) % 0x20), value);
        }
    }

    // Writes to memory, taking into account
    //      mirroring/mapping of address ranges.
    private PaletteRAMWriteMirror(address: number, value: number) {
        if (address == 0x3F00 || address == 0x3F10) {
            this.PPURAM[0x3F00] = value;
            this.PPURAM[0x3F00] = value;

        } else if (address == 0x3F04 || address == 0x3F14) {
            this.PPURAM[0x3F04] = value;
            this.PPURAM[0x3F14] = value;
        } else if (address == 0x3F08 || address == 0x3F18) {
            this.PPURAM[0x3F08] = value;
            this.PPURAM[0x3F18] = value;
        } else if (address == 0x3F0C || address == 0x3F1C) {
            this.PPURAM[0x3F0C] = value;
            this.PPURAM[0x3F1C] = value;
        }
    }

    private updatePalettes() {
        for (let i = 0; i < 16; i++) {
            if (!this.PPUMASK_GREYSCALE) {
                this.palettes[0].RGBColors[i] = Palette.NTSCRGBColors[this.PPURAM[0x3f00 + i] & 63];
            }
            else {
                this.palettes[0].RGBColors[i] = Palette.NTSCRGBColors[this.PPURAM[0x3f00 + i] & 32];
            }
            if ((i % 4) == 0) {
                this.palettes[0].RGBColors[i] = this.palettes[0].RGBColors[0];        // 0x3f04, 0x3f08, 0x3f0c is the mapping of 0x3f00
            }
        }
        for (let i = 0; i < 16; i++) {
            if (!this.PPUMASK_GREYSCALE) {
                this.palettes[1].RGBColors[i] = Palette.NTSCRGBColors[this.PPURAM[0x3f10 + i] & 63];
            }
            else {
                this.palettes[1].RGBColors[i] = Palette.NTSCRGBColors[this.PPURAM[0x3f10 + i] & 32];
            }
            if ((i % 4) == 0) {
                this.palettes[1].RGBColors[i] = this.palettes[0].RGBColors[0];        // 0x3f10, 0x3f14, 0x3f18, 0x3f1c is the mapping of 0x3f00
            }
        }
    }

    public writePPUData$4014(value: number): void {
        const baseAddress = value * 0x100;
        let data;
        for (let i = this.OAMAddr; i < 256; i++) {
            data = this.machine.cpu.mem[baseAddress + i];
            this.OAMData[i % 256] = data;

            this.spriteRamWriteUpdate(i, data);
        }

        this.machine.cpu.haltCycles += 513;
    }

    public getRealNametableNo(fromNo: number) {
        return this.nametableMapper[fromNo];
    }

    public drawFullScreenBg() {
        const bgcolor = this.palettes[0].RGBColors[0];
        for (let i = 0; i < 256 * 240; i++) {
            this.screenBuffer[i] = bgcolor;
        }
        Tile.backgroundColor = bgcolor;
    }

    private setStatusFlag(flag: number, value: boolean) {
        const n = 1 << flag;
        this.machine.cpu.mem[0x2002] =
            ((this.machine.cpu.mem[0x2002] & (255 - n)) | (value ? n : 0));
        switch (flag) {
            case PPU_STATUS.STATUS_VBLANK:
                this.PPUSTATUS_VBlank = value;
                break;
            case PPU_STATUS.STATUS_SPRITE0HIT:
                this.PPUSTATUS_Sprite0Hit = value;
                break;
        }
    }

    public incrementCycle(cycles: number) {
        let endFrame = false;

        while (cycles > 0 && (!endFrame)) {
            if (this.curX + cycles >= 340) {
                if (this.curScanline >= 0 && this.curScanline < 240) {
                    if (this.curScanline == 0) {
                        this.CntCoarseXScroll = this.CoarseXScroll;
                        this.CntCoarseYScroll = this.CoarseYScroll;
                        this.CntFineXScroll = this.FineXScroll;
                        this.CntFineYScroll = this.FineYScroll;
                        this.PPUCTRL_CntNameTableSelect = this.PPUCTRL_NameTableSelect;
                    }
                    if (this.PPUMASK_BackgroundEnable) {
                        this.drawScanline();

                        // Check for sprite 0 (next scanline):
                        if (!this.PPUSTATUS_Sprite0Hit && this.PPUMASK_SpriteEnable) {
                            if (this.sprX[0] >= -7 &&
                                this.sprX[0] < 256 &&
                                this.sprY[0] + 1 <= this.curScanline &&
                                (this.sprY[0] + 1 + (
                                    this.PPUCTRL_SpriteHeight ? 16 : 8
                                )) >= this.curScanline) {
                                if (this.checkSprite0Hit(this.curScanline)) {
                                    this.PPUSTATUS_Sprite0Hit = true;
                                }
                            }
                        }
                    }
                } else if (this.curScanline == 240) {
                    this.setStatusFlag(PPU_STATUS.STATUS_VBLANK, true);
                    this.setStatusFlag(PPU_STATUS.STATUS_SPRITE0HIT, false);
                    this.machine.cpu.requestINT(IRQType.IRQ_NMI);
                    this.renderSprites();
                } else if (this.curScanline == 261) {
                    this.setStatusFlag(PPU_STATUS.STATUS_VBLANK, false);
                    this.curScanline = -1;
                    endFrame = true;
                    this.machine.ui.writeFrame(this.screenBuffer, this.prevScreenBuffer);
                }
                this.curScanline++;
                this.curScanline = this.curScanline % 262;
            }
            // if (this.curX == this.PPUSTATUS_Sprite0HitX &&
            if (this.curX < this.PPUSTATUS_Sprite0HitX &&
                (this.curX + cycles >= this.PPUSTATUS_Sprite0HitX) &&
                this.curScanline == this.PPUSTATUS_Sprite0HitY + 1 &&
                this.PPUSTATUS_Sprite0Hit) {
                this.setStatusFlag(PPU_STATUS.STATUS_SPRITE0HIT, true);
            }

            if (this.curX + cycles >= 340) {
                cycles = (this.curX + cycles) % 340;
                this.curX = 0;
            }
            else {
                this.curX += cycles;
                cycles = 0;
            }
            // this.curX = (this.curX + cycles) % 340;

        }
        return endFrame;
    }

    private drawScanline() {
        const baseTileIndex = this.PPUCTRL_BackgroundTileSelect ? 256 : 0;
        this.CntCoarseXScroll = this.CoarseXScroll;
        this.CntFineXScroll = this.FineXScroll;
        this.PPUCTRL_CntNameTableSelect = this.PPUCTRL_NameTableSelect;

        let scanlineX = (this.curScanline << 8);
        for (let tileCount = 0; tileCount < 32; tileCount++) {
            let tile: Tile;
            let tileAttr: number;

            if (this.tileIndexCacheValid) {
                tile = this.tiles[this.tileIndexCache[this.CntCoarseXScroll]];
                tileAttr = this.tileAttrCache[this.CntCoarseXScroll];
            } else {
                const index = baseTileIndex + this.nametables[this.getRealNametableNo(this.PPUCTRL_CntNameTableSelect)].getTileIndex(this.CntCoarseXScroll, this.CntCoarseYScroll);
                tile = this.tiles[index];
                this.tileIndexCache[this.CntCoarseXScroll] = index;
                tileAttr = this.nametables[this.nametableMapper[this.PPUCTRL_CntNameTableSelect]].getAttrib(this.CntCoarseXScroll, this.CntCoarseYScroll);
                this.tileAttrCache[this.CntCoarseXScroll] = tileAttr;
            }

            for (let i = this.CntFineXScroll; i < 8; i++) {
                const dotLow2Bits = tile.pixels[(this.CntFineYScroll << 3) + i];
                this.screenBuffer[scanlineX++] = this.palettes[0].RGBColors[tileAttr + dotLow2Bits];
            }
            this.CntFineXScroll = 0;

            this.CntCoarseXScroll++;
            if (this.CntCoarseXScroll == 32) {
                this.CntCoarseXScroll = 0;
                this.PPUCTRL_CntNameTableSelect = ((Math.floor(this.PPUCTRL_CntNameTableSelect / 2)) << 1) + ((this.PPUCTRL_CntNameTableSelect + 1) % 2);

            }
        }
        this.tileIndexCacheValid = true;

        this.CntFineYScroll++;
        if (this.CntFineYScroll == 8) {
            this.tileIndexCacheValid = false;
            this.CntFineYScroll = 0;
            this.CntCoarseYScroll++;
            if (this.CntCoarseYScroll == 30) {
                this.CntCoarseYScroll = 0;
                this.PPUCTRL_CntNameTableSelect = (this.PPUCTRL_CntNameTableSelect + 2) % 4;
            }
        }
    }

    // Define a mirrored area in the address lookup table.
    // Assumes the regions don't overlap.
    // The 'to' region is the region that is physically in memory.
    //
    private setVRAMMirroringMap(fromStart: number, toStart: number, size: number): void {
        for (let i = 0; i < size; i++) {
            this.VRAMMirroringMap[fromStart + i] = toStart + i;
        }
    }

    public setMirroringType(type: MIRRORING_TYPE) {
        if (type == this.mirroringType) {
            return;
        }
        this.mirroringType = type;

        // Remove mirroring:
        if (this.VRAMMirroringMap == undefined) {
            this.VRAMMirroringMap = new Array(0x8000);
        }
        for (let i = 0; i < 0x8000; i++) {
            this.VRAMMirroringMap[i] = i;
        }

        // Palette mirroring:
        this.setVRAMMirroringMap(0x3f20, 0x3f00, 0x20);
        this.setVRAMMirroringMap(0x3f40, 0x3f00, 0x20);
        this.setVRAMMirroringMap(0x3f80, 0x3f00, 0x20);
        this.setVRAMMirroringMap(0x3fc0, 0x3f00, 0x20);

        // Additional mirroring:
        this.setVRAMMirroringMap(0x3000, 0x2000, 0xf00);
        this.setVRAMMirroringMap(0x4000, 0x0000, 0x4000);

        if (type == MIRRORING_TYPE.HORIZONTAL_MIRRORING) {
            // Horizontal mirroring.

            this.nametableMapper[0] = 0;
            this.nametableMapper[1] = 0;
            this.nametableMapper[2] = 1;
            this.nametableMapper[3] = 1;

            this.setVRAMMirroringMap(0x2400, 0x2000, 0x400);
            this.setVRAMMirroringMap(0x2c00, 0x2800, 0x400);

        } else if (type == MIRRORING_TYPE.VERTICAL_MIRRORING) {
            // Vertical mirroring.

            this.nametableMapper[0] = 0;
            this.nametableMapper[1] = 1;
            this.nametableMapper[2] = 0;
            this.nametableMapper[3] = 1;

            this.setVRAMMirroringMap(0x2800, 0x2000, 0x400);
            this.setVRAMMirroringMap(0x2c00, 0x2400, 0x400);
        } else if (type == MIRRORING_TYPE.SINGLESCREEN_MIRRORING) {
            this.nametableMapper[0] = 0;
            this.nametableMapper[1] = 0;
            this.nametableMapper[2] = 0;
            this.nametableMapper[3] = 0;

            this.setVRAMMirroringMap(0x2400, 0x2000, 0x400);
            this.setVRAMMirroringMap(0x2800, 0x2000, 0x400);
            this.setVRAMMirroringMap(0x2c00, 0x2000, 0x400);

        } else if (type == MIRRORING_TYPE.SINGLESCREEN_MIRRORING2) {
            this.nametableMapper[0] = 1;
            this.nametableMapper[1] = 1;
            this.nametableMapper[2] = 1;
            this.nametableMapper[3] = 1;

            this.setVRAMMirroringMap(0x2400, 0x2400, 0x400);
            this.setVRAMMirroringMap(0x2800, 0x2400, 0x400);
            this.setVRAMMirroringMap(0x2c00, 0x2400, 0x400);
        } else {
            this.nametableMapper[0] = 0;
            this.nametableMapper[1] = 1;
            this.nametableMapper[2] = 2;
            this.nametableMapper[3] = 3;
        }
    }

    //  Tile is updated byte by byte, but for a pixel it needs two bytes
    //  to determine the value of a pixel value in the byte, so we need
    //  this updateTileHelper to make sure that the tile pixels are updated
    //  immediately after the PPU mem write
    private updateTileHelper(address: number, value: number) {
        const tileIndex = Math.floor(address / 16);
        const leftOver = address % 16;
        if (leftOver < 8) {
            this.tiles[tileIndex].setScanline(
                leftOver,
                value,
                this.PPURAM[address + 8]
            );
        }
        else {
            this.tiles[tileIndex].setScanline(
                leftOver - 8,
                this.PPURAM[address - 8],
                value
            );
        }
    }

    private checkSprite0Hit(scanline: number) {
        this.PPUSTATUS_Sprite0HitX = -1;
        this.PPUSTATUS_Sprite0HitY = -1;

        let toffset;
        const tIndexAdd = this.PPUCTRL_BackgroundTileSelect ? 0 : 256;
        let t: Tile, i: number;
        let bufferIndex: number;                    // Bufferindex is the tile pixel index

        let x = this.sprX[0];

        // Sprite data is delayed by one scanline;
        // you must subtract 1 from the sprite's Y coordinate
        const y = this.sprY[0] + 1;

        const spriteHeight = this.PPUCTRL_SpriteHeight ? 16 : 8;
        if (y <= scanline && y + spriteHeight > scanline && x >= -7 && x < 256) {

        }

        if (this.sprVertFlip[0]) {
            toffset = spriteHeight - (scanline - y);
        } else {
            toffset = scanline - y;
        }

        if (this.PPUCTRL_SpriteHeight) {
            if (toffset < 8) {
                // first half of sprite.
                t = this.tiles[this.sprTile[0] + (this.sprVertFlip[0] ? 1 : 0) + ((this.sprTile[0] & 1) !== 0 ? 255 : 0)];
            } else {
                // second half of sprite.
                t = this.tiles[this.sprTile[0] + (this.sprVertFlip[0] ? 0 : 1) + ((this.sprTile[0] & 1) !== 0 ? 255 : 0)];
                if (this.sprVertFlip[0]) {
                    toffset = 15 - toffset;
                }
                else {
                    toffset -= 8;
                }
            }
        } else {
            t = this.tiles[this.sprTile[0] + tIndexAdd];
        }

        toffset *= 8;

        bufferIndex = scanline * 256 + x;

        const stepValue = this.sprHoriFlip[0] ? -1 : 1;
        const stepBase = this.sprHoriFlip[0] ? 7 : 0;

        for (i = 0; i < 8; i++) {
            if (x >= 0 && x < 256) {
                if (bufferIndex >= 0 && bufferIndex < 61440 && this.screenBuffer[bufferIndex] !== 0) {
                    if (t.pixels[toffset + stepBase + i * stepValue] !== 0) {
                        this.PPUSTATUS_Sprite0HitX = bufferIndex % 256;
                        this.PPUSTATUS_Sprite0HitY = scanline;
                        return true;
                    }
                }
            }
            x++;
            bufferIndex++;
        }

        return false;
    }

    // Updates the internally buffered sprite
    // data with this new byte of info.
    private spriteRamWriteUpdate(address: number, value: number) {
        const tIndex = Math.floor(address / 4);

        if (tIndex === 0) {
            this.checkSprite0Hit(this.curScanline);
        }

        if (address % 4 === 0) {
            // Y coordinate
            this.sprY[tIndex] = value;
        }
        else if (address % 4 == 1) {
            // Tile index
            this.sprTile[tIndex] = value;
        }
        else if (address % 4 == 2) {
            // Attributes
            this.sprVertFlip[tIndex] = ((value & 0x80) !== 0);
            this.sprHoriFlip[tIndex] = ((value & 0x40) !== 0);
            this.sprCol[tIndex] = (value & 3) << 2;
            this.sprBehindBackground[tIndex] = ((value & 0x20) !== 0);
        }
        else if (address % 4 == 3) {
            // X coordinate
            this.sprX[tIndex] = value;
        }
    }

    private renderSprites() {
        if (!this.PPUMASK_SpriteEnable) {
            return;
        }

        for (let i = 63; i >= 0; i--) {
            if (this.sprX[i] >= 0 &&
                this.sprX[i] < 256 &&
                this.sprY[i] + 8 >= 0 &&
                this.sprY[i] < 240) {
                // Show sprite.
                if (!this.PPUCTRL_SpriteHeight) {
                    // 8x8 sprites

                    let srcy1 = 0;
                    let srcy2 = 8;

                    if (this.sprY[i] < 0) {
                        srcy1 = 240 - this.sprY[i] - 1;
                    }

                    if (this.sprY[i] + 8 > 240) {
                        srcy2 = 240 - this.sprY[i] + 1;
                    }

                    this.tiles[this.sprTile[i] + (this.PPUCTRL_SpriteTileSelect ? 256 : 0)].render(
                        this.screenBuffer,
                        0, srcy1, 8, srcy2, this.sprX[i],
                        this.sprY[i] + 1, this.sprCol[i], this.palettes[1],
                        this.sprHoriFlip[i], this.sprVertFlip[i],
                        this.sprBehindBackground[i]
                    );
                } else {
                    // 8x16 sprites
                    let top = this.sprTile[i];
                    if ((top & 1) !== 0) {
                        top = this.sprTile[i] - 1 + 256;
                    }

                    let srcy1 = 0;
                    let srcy2 = 8;

                    if (this.sprY[i] < 0) {
                        srcy1 = 0 - this.sprY[i] - 1;
                    }

                    if (this.sprY[i] + 8 > 240) {
                        srcy2 = 240 - this.sprY[i];
                    }

                    this.tiles[top + (this.sprVertFlip[i] ? 1 : 0)].render(
                        this.screenBuffer,
                        0,
                        srcy1,
                        8,
                        srcy2,
                        this.sprX[i],
                        this.sprY[i] + 1,
                        this.sprCol[i],
                        this.palettes[1],
                        this.sprHoriFlip[i],
                        this.sprVertFlip[i],
                        this.sprBehindBackground[i]
                    );

                    srcy1 = 0;
                    srcy2 = 8;

                    if (this.sprY[i] + 8 < 0) {
                        srcy1 = 0 - (this.sprY[i] + 8 + 1);
                    }

                    if (this.sprY[i] + 16 > 0 + 240) {
                        srcy2 = 240 - (this.sprY[i] + 8);
                    }

                    this.tiles[top + (this.sprVertFlip[i] ? 0 : 1)].render(
                        this.screenBuffer,
                        0,
                        srcy1,
                        8,
                        srcy2,
                        this.sprX[i],
                        this.sprY[i] + 1 + 8,
                        this.sprCol[i],
                        this.palettes[1],
                        this.sprHoriFlip[i],
                        this.sprVertFlip[i],
                        this.sprBehindBackground[i]
                    );
                }
            }
        }
    }
}
