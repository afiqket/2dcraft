import './style.css';
import Phaser from 'phaser';

type GridPosition = { x: number; y: number };
type TileId = 0 | 1 | 2 | 3 | 4;
type Floor = 'water' | 'grass';
type ArcadeBody = Phaser.Physics.Arcade.Body;
type StaticArcadeBody = Phaser.Physics.Arcade.StaticBody;
type ImageWithBody = Phaser.GameObjects.Image & { body: ArcadeBody };
type RectangleWithBody = Phaser.GameObjects.Rectangle & {
  body: ArcadeBody | StaticArcadeBody;
};
type KeyMap = Record<string, Phaser.Input.Keyboard.Key>;
type TransformGameObject =
  Phaser.GameObjects.GameObject &
  Phaser.GameObjects.Components.Transform;

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 500;
const TILE_SIZE = 50;
const PLAYER_SIZE = 100;
const PLAYER_SPEED = 200;

const DEPTHS = {
  TILES: 0,
  BLOCKS: 10,
  HOVER: 20,
  PLAYER: 30,
  TEXT: 100,
} as const;

const PIXEL_TO_TILE: Record<number, TileId> = {
  0x41a6f6: 0,
  0xa7f070: 1,
  0x257179: 2,
  0x3b5dc9: 3,
  0xb13e53: 4,
};

const DASH_VELOCITY_SCALE = 3;
const DASH_TIME_MS = 150;
const DASH_COOLDOWN_MS = 200;

const BLOCK_BREAK_TIME_MS = 500;
const BREAK_ANIM_INTERVAL = 250;

class Grid {
  static toWorld(x: number, y: number): GridPosition {
    return {
      x: x * TILE_SIZE,
      y: y * TILE_SIZE,
    };
  }
}

class GameEffects {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private scene: Phaser.Scene) {
    this.emitter = this.scene.add
      .particles(0, 0, 'tree_particle', {
        speed: 300,
        lifespan: 150,
        gravityY: 1000,
        scale: 1,
        duration: 100,
        emitting: false,
      })
      .setDepth(DEPTHS.PLAYER);
  }

  shake(obj: TransformGameObject): void {
    const objX = obj.x;
    const objY = obj.y;

    this.scene.tweens.add({
      targets: obj,
      x: objX + 4,
      y: objY - 4,
      duration: 50,
      yoyo: true,
      repeat: 2,
      onComplete: () => {
        obj.x = objX;
        obj.y = objY;
      },
    });
  }

  breaking(obj: TransformGameObject): void {
    this.emitter.startFollow(obj);
    this.emitter.start();
    this.shake(obj);
  }
}

class InventoryUI {
  private text: Phaser.GameObjects.Text;
  private woodCount = 0;

  constructor(private scene: Phaser.Scene) {
    this.text = this.scene.add
      .text(20, CANVAS_HEIGHT - 60, '', {
        font: '25px Monospace',
        color: '#000000',
      })
      .setScrollFactor(0)
      .setDepth(DEPTHS.TEXT);

    this.updateText();
  }

  getTextObject(): Phaser.GameObjects.Text {
    return this.text;
  }

  getWoodCount(): number {
    return this.woodCount;
  }

  addWood(amount: number): void {
    this.woodCount += amount;
    this.updateText();
  }

  removeWood(amount: number): boolean {
    if (this.woodCount < amount) {
      return false;
    }

    this.woodCount -= amount;
    this.updateText();
    return true;
  }

  private updateText(): void {
    this.text.setText(`(1) WOOD: ${this.woodCount}`);
  }
}


class Player {
  private sprite: ImageWithBody;
  private keys: KeyMap;
  private isInputStopped = false;
  private isDashOnCooldown = false;

  constructor(private scene: Phaser.Scene, spawn: GridPosition) {
    this.sprite = this.scene.add
      .image(spawn.x, spawn.y, 'player_down')
      .setDisplaySize(PLAYER_SIZE, PLAYER_SIZE)
      .setDepth(DEPTHS.PLAYER) as ImageWithBody;

    this.scene.physics.add.existing(this.sprite);
    this.sprite.body.setSize(this.sprite.width / 3, this.sprite.height / 3, true);
    this.sprite.body.setCollideWorldBounds(true);

    this.keys = this.scene.input.keyboard!.addKeys(
      'W,A,S,D,LEFT,RIGHT,UP,DOWN,R,ONE,TWO,X,SPACE',
    ) as KeyMap;

    this.scene.input.keyboard!.on('keydown-SPACE', () => {
      this.dash();
    });
  }

  getSprite(): ImageWithBody {
    return this.sprite;
  }

  isResetPressed(): boolean {
    return this.keys.R.isDown;
  }

  update(): void {
    if (this.keys.ONE.isDown) {

    }
    this.keys.TWO.isDown

    if (this.isInputStopped) {
      return;
    }

    const isUp = this.keys.UP.isDown || this.keys.W.isDown;
    const isLeft = this.keys.LEFT.isDown || this.keys.A.isDown;
    const isDown = this.keys.DOWN.isDown || this.keys.S.isDown;
    const isRight = this.keys.RIGHT.isDown || this.keys.D.isDown;

    let velocityX = 0;
    let velocityY = 0;

    if (isUp) {
      this.sprite.setTexture('player_up');
      velocityY = -1;
    } else if (isDown) {
      this.sprite.setTexture('player_down');
      velocityY = 1;
    }

    if (isLeft) {
      this.sprite.setTexture('player_left');
      velocityX = -1;
    } else if (isRight) {
      this.sprite.setTexture('player_right');
      velocityX = 1;
    }

    const vec = new Phaser.Math.Vector2(velocityX, velocityY)
      .normalize()
      .scale(PLAYER_SPEED);

    this.sprite.body.setVelocity(vec.x, vec.y);
  }

  private dash(): void {
    if (this.isDashOnCooldown) {
      return;
    }

    const velocityX = this.sprite.body.velocity.x;
    const velocityY = this.sprite.body.velocity.y;

    this.isDashOnCooldown = true;
    this.isInputStopped = true;

    this.sprite.body.setVelocity(
      velocityX * DASH_VELOCITY_SCALE,
      velocityY * DASH_VELOCITY_SCALE,
    );

    this.scene.time.delayedCall(DASH_TIME_MS, () => {
      this.isInputStopped = false;
    });

    this.scene.time.delayedCall(DASH_COOLDOWN_MS, () => {
      this.isDashOnCooldown = false;
    });
  }
}

class Tile {
  private rect: RectangleWithBody;
  private block: RectangleWithBody | null = null;

  constructor(
    private scene: Phaser.Scene,
    public readonly gridX: number,
    public readonly gridY: number,
    public readonly floor: Floor,
    color: number,
  ) {
    const world = Grid.toWorld(gridX, gridY);

    this.rect = this.scene.add
      .rectangle(world.x, world.y, TILE_SIZE, TILE_SIZE, color, 1)
      .setStrokeStyle(1, 0x444444, 1)
      .setDepth(DEPTHS.TILES) as RectangleWithBody;

    this.scene.physics.add.existing(this.rect, true);
    this.rect.setInteractive();
  }

  getGameObject(): RectangleWithBody {
    return this.rect;
  }

  getBlock(): RectangleWithBody | null {
    return this.block;
  }

  hasBlock(): boolean {
    return this.block !== null;
  }

  placeBlock(blockGroup: Phaser.Physics.Arcade.StaticGroup): RectangleWithBody {
    const block = this.scene.add
      .rectangle(this.rect.x, this.rect.y, TILE_SIZE, TILE_SIZE, 0x895129, 1)
      .setDepth(DEPTHS.BLOCKS) as RectangleWithBody;

    this.scene.physics.add.existing(block, true);
    blockGroup.add(block);

    this.block = block;
    return block;
  }

  destroyBlock(): RectangleWithBody | null {
    if (!this.block) {
      return null;
    }

    const oldBlock = this.block;
    oldBlock.destroy();
    this.block = null;

    return oldBlock;
  }

  onPointerDown(callback: (pointer: Phaser.Input.Pointer, tile: Tile) => void): void {
    this.rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      callback(pointer, this);
    });
  }

  onPointerOver(callback: (tile: Tile) => void): void {
    this.rect.on('pointerover', () => {
      callback(this);
    });
  }

  onPointerOut(callback: (tile: Tile) => void): void {
    this.rect.on('pointerout', () => {
      callback(this);
    });
  }
}

class HoverBox {
  private rect: RectangleWithBody;

  constructor(private scene: Phaser.Scene) {
    this.rect = this.scene.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0x000000, 0)
      .setStrokeStyle(2, 0xff0000, 1)
      .setDepth(DEPTHS.HOVER)
      .setVisible(false) as RectangleWithBody;

    this.scene.physics.add.existing(this.rect, true);
  }

  getGameObject(): RectangleWithBody {
    return this.rect;
  }

  showAt(tile: Tile): void {
    const tileObj = tile.getGameObject();

    this.rect.setPosition(tileObj.x, tileObj.y);
    this.rect.setVisible(true);
    this.rect.body.updateFromGameObject();
  }

  hide(): void {
    this.rect.setVisible(false);
  }
}

class Tree {
  private sprite: Phaser.GameObjects.Image;
  private breakingTimer: Phaser.Time.TimerEvent | undefined;
  private breakingAnimTimer: Phaser.Time.TimerEvent | undefined;

  constructor(
    private scene: Phaser.Scene,
    private effects: GameEffects,
    private inventory: InventoryUI,
    x: number,
    y: number,
    treeGroup: Phaser.Physics.Arcade.StaticGroup,
  ) {
    const world = Grid.toWorld(x, y);

    this.sprite = this.scene.add
      .image(world.x, world.y, 'tree')
      .setDepth(DEPTHS.BLOCKS)
      .setDisplaySize(TILE_SIZE, TILE_SIZE);

    this.sprite.setInteractive();
    treeGroup.add(this.sprite);

    this.sprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        return;
      }

      this.startBreaking();
    });

    this.sprite.on('pointerup', () => {
      this.cancelBreaking();
    });

    this.sprite.on('pointerout', () => {
      this.cancelBreaking();
    });
  }

  private startBreaking(): void {
    this.cancelBreaking();

    this.effects.breaking(this.sprite);

    this.breakingTimer = this.scene.time.delayedCall(BLOCK_BREAK_TIME_MS, () => {
      this.sprite.destroy();
      this.breakingTimer = undefined;

      this.inventory.addWood(2);
      this.effects.shake(this.inventory.getTextObject());
    });

    this.breakingAnimTimer = this.scene.time.addEvent({
      delay: BREAK_ANIM_INTERVAL,
      loop: true,
      callback: () => {
        if (!this.sprite.active) {
          this.cancelBreaking();
          return;
        }

        this.effects.breaking(this.sprite);
      },
    });
  }

  private cancelBreaking(): void {
    if (this.breakingTimer) {
      this.breakingTimer.remove(false);
      this.breakingTimer = undefined;
    }

    if (this.breakingAnimTimer) {
      this.breakingAnimTimer.remove(false);
      this.breakingAnimTimer = undefined;
    }
  }
}

class MapLoader {
  constructor(private scene: Phaser.Scene) {}

  buildFromImage(textureKey: string): TileId[][] {
    const sourceImage = this.scene.textures
      .get(textureKey)
      .getSourceImage() as HTMLImageElement | HTMLCanvasElement;

    const canvas = document.createElement('canvas');
    canvas.width = sourceImage.width;
    canvas.height = sourceImage.height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      throw new Error('Could not create 2D canvas context.');
    }

    ctx.drawImage(sourceImage, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const result: TileId[][] = [];

    for (let y = 0; y < canvas.height; y++) {
      const row: TileId[] = [];

      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;

        const r = imageData[index];
        const g = imageData[index + 1];
        const b = imageData[index + 2];

        const hex = (r << 16) | (g << 8) | b;
        const tileId = PIXEL_TO_TILE[hex];

        if (tileId === undefined) {
          throw new Error(
            `Unknown map color at (${x}, ${y}): 0x${hex
              .toString(16)
              .toUpperCase()
              .padStart(6, '0')}`,
          );
        }

        row.push(tileId);
      }

      result.push(row);
    }

    return result;
  }
}

class GameWorld {
  private tiles: Tile[] = [];
  private map: TileId[][] = [];
  private mapWidth = 0;
  private mapHeight = 0;
  private playerSpawnPosition: GridPosition | null = null;
  private isInvalidPlacement = false;

  readonly blockGroup: Phaser.Physics.Arcade.StaticGroup;
  readonly treeGroup: Phaser.Physics.Arcade.StaticGroup;
  readonly hoverBox: HoverBox;

  constructor(
    private scene: Phaser.Scene,
    private effects: GameEffects,
    private inventory: InventoryUI,
  ) {
    this.blockGroup = this.scene.physics.add.staticGroup();
    this.treeGroup = this.scene.physics.add.staticGroup();
    this.hoverBox = new HoverBox(this.scene);
  }

  build(): GridPosition {
    const mapLoader = new MapLoader(this.scene);

    this.map = mapLoader.buildFromImage('map');
    this.mapWidth = this.map[0].length * TILE_SIZE;
    this.mapHeight = this.map.length * TILE_SIZE;

    this.scene.physics.world.setBounds(
      -TILE_SIZE / 2,
      -TILE_SIZE / 2,
      this.mapWidth,
      this.mapHeight,
    );

    for (let row = 0; row < this.map.length; row++) {
      for (let col = 0; col < this.map[row].length; col++) {
        this.createTileFromId(col, row, this.map[row][col]);
      }
    }

    if (!this.playerSpawnPosition) {
      throw new Error('No player spawn tile found in map.png. Use color 0x3B5DC9.');
    }

    return Grid.toWorld(this.playerSpawnPosition.x, this.playerSpawnPosition.y);
  }

  getWidth(): number {
    return this.mapWidth;
  }

  getHeight(): number {
    return this.mapHeight;
  }

  updatePlacementState(player: Player): void {
    this.isInvalidPlacement =
      this.scene.physics.overlap(player.getSprite(), this.hoverBox.getGameObject()) ||
      this.scene.physics.overlap(this.treeGroup, this.hoverBox.getGameObject());
  }

  private createTileFromId(col: number, row: number, tileId: TileId): void {
    let floor: Floor = 'grass';
    let color = 0x77dd77;

    switch (tileId) {
      case 0:
        floor = 'water';
        color = 0x4f92d4;
        break;

      case 1:
      case 4:
        floor = 'grass';
        color = 0x77dd77;
        break;

      case 2:
        floor = 'grass';
        color = 0x77dd77;
        new Tree(this.scene, this.effects, this.inventory, col, row, this.treeGroup);
        break;

      case 3:
        floor = 'grass';
        color = 0x77dd77;
        this.playerSpawnPosition = { x: col, y: row };
        break;
    }

    const tile = new Tile(this.scene, col, row, floor, color);

    tile.onPointerDown((pointer, selectedTile) => {
      this.handleTileClick(pointer, selectedTile);
    });

    tile.onPointerOver((selectedTile) => {
      this.hoverBox.showAt(selectedTile);
    });

    tile.onPointerOut(() => {
      this.hoverBox.hide();
    });

    this.tiles.push(tile);
  }

  private handleTileClick(pointer: Phaser.Input.Pointer, tile: Tile): void {
    if (pointer.rightButtonDown()) {
      this.tryPlaceBlock(tile);
      return;
    }

    if (pointer.leftButtonDown()) {
      this.tryBreakBlock(tile);
    }
  }

  private tryPlaceBlock(tile: Tile): void {
    if (
      tile.hasBlock() ||
      this.isInvalidPlacement ||
      this.inventory.getWoodCount() === 0
    ) {
      return;
    }

    tile.placeBlock(this.blockGroup);
    this.inventory.removeWood(1);
  }

  private tryBreakBlock(tile: Tile): void {
    const block = tile.getBlock();

    if (!block) {
      return;
    }

    this.effects.breaking(block);
    tile.destroyBlock();

    this.inventory.addWood(1);
    this.effects.shake(this.inventory.getTextObject());
  }
}

class GameManager {
  private effects!: GameEffects;
  private inventory!: InventoryUI;
  private world!: GameWorld;
  private player!: Player;

  constructor(private scene: Phaser.Scene) {}

  create(): void {
    this.scene.input.mouse?.disableContextMenu();
    this.scene.input.setTopOnly(false);

    this.setTextureFilters();

    this.effects = new GameEffects(this.scene);
    this.inventory = new InventoryUI(this.scene);
    this.world = new GameWorld(this.scene, this.effects, this.inventory);

    const playerSpawn = this.world.build();
    this.player = new Player(this.scene, playerSpawn);

    this.scene.physics.add.collider(this.player.getSprite(), this.world.blockGroup);
    this.scene.physics.add.collider(this.player.getSprite(), this.world.treeGroup);

    this.scene.cameras.main.setBounds(
      -TILE_SIZE / 2,
      -TILE_SIZE / 2,
      this.world.getWidth(),
      this.world.getHeight(),
    );

    this.scene.cameras.main.startFollow(this.player.getSprite(), true);
    this.scene.cameras.main.setZoom(1);
  }

  update(): void {
    if (this.player.isResetPressed()) {
      resetGame();
      return;
    }

    this.player.update();
    this.world.updatePlacementState(this.player);
  }

  private setTextureFilters(): void {
    const textureKeys = [
      'tree',
      'player_down',
      'player_up',
      'player_left',
      'player_right',
    ];

    for (const key of textureKeys) {
      this.scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }
}

class GameScene extends Phaser.Scene {
  private manager!: GameManager;

  constructor() {
    super('scene-game');
  }

  preload(): void {
    this.load.image('tree', './assets/tree.png');
    this.load.image('tree_particle', './assets/tree_particle.png');
    this.load.image('map', './assets/map.png');
    this.load.image('player_down', './assets/player_down.png');
    this.load.image('player_right', './assets/player_right.png');
    this.load.image('player_left', './assets/player_left.png');
    this.load.image('player_up', './assets/player_up.png');
  }

  create(): void {
    this.manager = new GameManager(this);
    this.manager.create();
  }

  update(): void {
    this.manager.update();
  }
}

const gameCanvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  ...(gameCanvas ? { canvas: gameCanvas } : {}),
  physics: {
    default: 'arcade',
    arcade: {
      // debug: true,
    },
  },
  scene: [GameScene],
};

let game: Phaser.Game = new Phaser.Game(config);

function resetGame(): void {
  game.destroy(false);
  game = new Phaser.Game(config);
}