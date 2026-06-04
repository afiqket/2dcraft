import './style.css';
import Phaser from 'phaser';

type GridPosition = { x: number; y: number };
type TileId = 0 | 1 | 2 | 3 | 4;
type FloorKind = 'grass' | 'water' | 'wooden_floor';
type BlockKind = 'tree' | 'wooden_block';
type GameMode = 'normal' | 'build';
type BuildItem = 'wooden_floor' | 'wooden_block';
type ArcadeBody = Phaser.Physics.Arcade.Body;
type StaticArcadeBody = Phaser.Physics.Arcade.StaticBody;
type ImageWithBody = Phaser.GameObjects.Image & { body: ArcadeBody };
type ImageWithStaticBody = Phaser.GameObjects.Image & { body: StaticArcadeBody };
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
  FLOORS: 0,
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

class Inventory {
  private woodCount = 0;
  private onChangedCallbacks: (() => void)[] = [];

  getWoodCount(): number {
    return this.woodCount;
  }

  addWood(amount: number): void {
    this.woodCount += amount;
    this.notifyChanged();
  }

  removeWood(amount: number): boolean {
    if (this.woodCount < amount) {
      return false;
    }

    this.woodCount -= amount;
    this.notifyChanged();
    return true;
  }

  onChanged(callback: () => void): void {
    this.onChangedCallbacks.push(callback);
  }

  private notifyChanged(): void {
    for (const callback of this.onChangedCallbacks) {
      callback();
    }
  }
}

class InputManager {
  private keys: KeyMap;

  constructor(private scene: Phaser.Scene) {
    this.keys = this.scene.input.keyboard!.addKeys(
      'W,A,S,D,LEFT,RIGHT,UP,DOWN,R,B,ONE,TWO,SPACE',
    ) as KeyMap;
  }

  onDash(callback: () => void): void {
    this.scene.input.keyboard!.on('keydown-SPACE', callback);
  }

  onToggleBuild(callback: () => void): void {
    this.scene.input.keyboard!.on('keydown-B', callback);
  }

  onSelectWoodenFloor(callback: () => void): void {
    this.scene.input.keyboard!.on('keydown-ONE', callback);
  }

  onSelectWoodenBlock(callback: () => void): void {
    this.scene.input.keyboard!.on('keydown-TWO', callback);
  }

  isResetPressed(): boolean {
    return this.keys.R.isDown;
  }

  getMovementVector(): Phaser.Math.Vector2 {
    const isUp = this.keys.UP.isDown || this.keys.W.isDown;
    const isLeft = this.keys.LEFT.isDown || this.keys.A.isDown;
    const isDown = this.keys.DOWN.isDown || this.keys.S.isDown;
    const isRight = this.keys.RIGHT.isDown || this.keys.D.isDown;

    let x = 0;
    let y = 0;

    if (isUp) {
      y = -1;
    } else if (isDown) {
      y = 1;
    }

    if (isLeft) {
      x = -1;
    } else if (isRight) {
      x = 1;
    }

    return new Phaser.Math.Vector2(x, y);
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

  constructor(
    private scene: Phaser.Scene,
    private inventory: Inventory,
  ) {
    this.text = this.scene.add
      .text(20, CANVAS_HEIGHT - 60, '', {
        font: '25px Monospace',
        color: '#000000',
      })
      .setScrollFactor(0)
      .setDepth(DEPTHS.TEXT);

    this.inventory.onChanged(() => {
      this.updateText();
    });

    this.updateText();
  }

  getTextObject(): Phaser.GameObjects.Text {
    return this.text;
  }

  updateText(): void {
    this.text.setText(`WOOD: ${this.inventory.getWoodCount()}`);
  }
}

class BuildUI {
  private container: Phaser.GameObjects.Container;
  private titleText: Phaser.GameObjects.Text;
  private floorText: Phaser.GameObjects.Text;
  private blockText: Phaser.GameObjects.Text;
  private selectedItem: BuildItem = 'wooden_floor';

  constructor(private scene: Phaser.Scene) {
    const bg = this.scene.add.rectangle(180, 80, 320, 110, 0xffffff, 0.9);

    this.titleText = this.scene.add.text(35, 35, 'BUILD UI', {
      font: '20px Monospace',
      color: '#000000',
    });

    this.floorText = this.scene.add.text(35, 65, '', {
      font: '18px Monospace',
      color: '#000000',
    });

    this.blockText = this.scene.add.text(35, 90, '', {
      font: '18px Monospace',
      color: '#000000',
    });

    this.container = this.scene.add
      .container(0, 0, [bg, this.titleText, this.floorText, this.blockText])
      .setScrollFactor(0)
      .setDepth(DEPTHS.TEXT)
      .setVisible(false);

    this.updateText();
  }

  show(): void {
    this.container.setVisible(true);
  }

  hide(): void {
    this.container.setVisible(false);
  }

  isVisible(): boolean {
    return this.container.visible;
  }

  selectItem(item: BuildItem): void {
    this.selectedItem = item;
    this.updateText();
  }

  getSelectedItem(): BuildItem {
    return this.selectedItem;
  }

  private updateText(): void {
    const floorPrefix = this.selectedItem === 'wooden_floor' ? '>' : ' ';
    const blockPrefix = this.selectedItem === 'wooden_block' ? '>' : ' ';

    this.floorText.setText(`${floorPrefix} 1. Floor: Wooden Floor`);
    this.blockText.setText(`${blockPrefix} 2. Block: Wooden Block`);
  }
}

class GameUI {
  readonly inventoryUI: InventoryUI;
  readonly buildUI: BuildUI;

  constructor(scene: Phaser.Scene, inventory: Inventory) {
    this.inventoryUI = new InventoryUI(scene, inventory);
    this.buildUI = new BuildUI(scene);
  }

  setMode(mode: GameMode): void {
    if (mode === 'build') {
      this.buildUI.show();
      return;
    }

    this.buildUI.hide();
  }

  getSelectedBuildItem(): BuildItem {
    return this.buildUI.getSelectedItem();
  }
}

class Player {
  private sprite: ImageWithBody;
  private isInputStopped = false;
  private isDashOnCooldown = false;

  constructor(
    private scene: Phaser.Scene,
    private inputManager: InputManager,
    spawn: GridPosition,
  ) {
    this.sprite = this.scene.add
      .image(spawn.x, spawn.y, 'player_down')
      .setDisplaySize(PLAYER_SIZE, PLAYER_SIZE)
      .setDepth(DEPTHS.PLAYER) as ImageWithBody;

    this.scene.physics.add.existing(this.sprite);
    this.sprite.body.setSize(this.sprite.width / 3, this.sprite.height / 3, true);
    this.sprite.body.setCollideWorldBounds(true);

    this.inputManager.onDash(() => {
      this.dash();
    });
  }

  getSprite(): ImageWithBody {
    return this.sprite;
  }

  update(): void {
    if (this.isInputStopped) {
      return;
    }

    const movement = this.inputManager.getMovementVector();

    if (movement.y < 0) {
      this.sprite.setTexture('player_up');
    } else if (movement.y > 0) {
      this.sprite.setTexture('player_down');
    }

    if (movement.x < 0) {
      this.sprite.setTexture('player_left');
    } else if (movement.x > 0) {
      this.sprite.setTexture('player_right');
    }

    const velocity = movement.normalize().scale(PLAYER_SPEED);
    this.sprite.body.setVelocity(velocity.x, velocity.y);
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

abstract class Floor {
  abstract readonly kind: FloorKind;
  protected rect: RectangleWithBody;

  constructor(
    protected scene: Phaser.Scene,
    protected gridX: number,
    protected gridY: number,
    color: number,
    strokeColor: number,
  ) {
    const world = Grid.toWorld(gridX, gridY);

    this.rect = this.scene.add
      .rectangle(world.x, world.y, TILE_SIZE, TILE_SIZE, color, 1)
      .setStrokeStyle(1, strokeColor, 1)
      .setDepth(DEPTHS.FLOORS) as RectangleWithBody;

    this.scene.physics.add.existing(this.rect, true);
    this.rect.setInteractive();
  }

  getGameObject(): RectangleWithBody {
    return this.rect;
  }

  canSupportBlock(): boolean {
    return false;
  }

  canBeReplacedByWoodenFloor(): boolean {
    return this.kind !== 'wooden_floor';
  }

  destroy(): void {
    this.rect.destroy();
  }
}

class GrassFloor extends Floor {
  readonly kind = 'grass' as const;

  constructor(scene: Phaser.Scene, gridX: number, gridY: number) {
    super(scene, gridX, gridY, 0x77dd77, 0x444444);
  }

  canSupportBlock(): boolean {
    return true;
  }
}

class WaterFloor extends Floor {
  readonly kind = 'water' as const;

  constructor(scene: Phaser.Scene, gridX: number, gridY: number) {
    super(scene, gridX, gridY, 0x4f92d4, 0x444444);
  }
}

class WoodenFloor extends Floor {
  readonly kind = 'wooden_floor' as const;

  constructor(scene: Phaser.Scene, gridX: number, gridY: number) {
    super(scene, gridX, gridY, 0xb68a4c, 0x5a3217);
  }

  canSupportBlock(): boolean {
    return true;
  }

  canBeReplacedByWoodenFloor(): boolean {
    return false;
  }
}

abstract class Block {
  abstract readonly kind: BlockKind;

  constructor(protected onDestroyed: (block: Block) => void) {}

  abstract getGameObject(): TransformGameObject;

  canBeBrokenByBuildTool(): boolean {
    return false;
  }

  destroy(): void {
    this.getGameObject().destroy();
    this.onDestroyed(this);
  }
}

class WoodenBlock extends Block {
  readonly kind = 'wooden_block' as const;
  private rect: RectangleWithBody;

  constructor(
    scene: Phaser.Scene,
    gridX: number,
    gridY: number,
    blockGroup: Phaser.Physics.Arcade.StaticGroup,
    onDestroyed: (block: Block) => void,
  ) {
    super(onDestroyed);

    const world = Grid.toWorld(gridX, gridY);

    this.rect = scene.add
      .rectangle(world.x, world.y, TILE_SIZE, TILE_SIZE, 0x895129, 1)
      .setDepth(DEPTHS.BLOCKS) as RectangleWithBody;

    scene.physics.add.existing(this.rect, true);
    blockGroup.add(this.rect);
  }

  getGameObject(): RectangleWithBody {
    return this.rect;
  }

  canBeBrokenByBuildTool(): boolean {
    return true;
  }
}

class TreeBlock extends Block {
  readonly kind = 'tree' as const;
  private sprite: ImageWithStaticBody;
  private breakingTimer: Phaser.Time.TimerEvent | undefined;
  private breakingAnimTimer: Phaser.Time.TimerEvent | undefined;

  constructor(
    private scene: Phaser.Scene,
    private effects: GameEffects,
    private inventory: Inventory,
    private inventoryUI: InventoryUI,
    gridX: number,
    gridY: number,
    blockGroup: Phaser.Physics.Arcade.StaticGroup,
    onDestroyed: (block: Block) => void,
  ) {
    super(onDestroyed);

    const world = Grid.toWorld(gridX, gridY);

    this.sprite = this.scene.add
      .image(world.x, world.y, 'tree')
      .setDepth(DEPTHS.BLOCKS)
      .setDisplaySize(TILE_SIZE, TILE_SIZE) as ImageWithStaticBody;

    this.sprite.setInteractive();
    blockGroup.add(this.sprite);

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

  getGameObject(): ImageWithStaticBody {
    return this.sprite;
  }

  private startBreaking(): void {
    this.cancelBreaking();

    this.effects.breaking(this.sprite);

    this.breakingTimer = this.scene.time.delayedCall(BLOCK_BREAK_TIME_MS, () => {
      this.destroy();
      this.breakingTimer = undefined;

      this.inventory.addWood(2);
      this.effects.shake(this.inventoryUI.getTextObject());
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

class Tile {
  private block: Block | null = null;
  private pointerDownCallbacks: ((pointer: Phaser.Input.Pointer, tile: Tile) => void)[] = [];
  private pointerOverCallbacks: ((tile: Tile) => void)[] = [];
  private pointerOutCallbacks: ((tile: Tile) => void)[] = [];

  constructor(
    private scene: Phaser.Scene,
    public readonly gridX: number,
    public readonly gridY: number,
    private floor: Floor,
  ) {
    this.bindInputToFloor();
  }

  getFloor(): Floor {
    return this.floor;
  }

  getFloorKind(): FloorKind {
    return this.floor.kind;
  }

  getFloorGameObject(): RectangleWithBody {
    return this.floor.getGameObject();
  }

  getBlock(): Block | null {
    return this.block;
  }

  hasBlock(): boolean {
    return this.block !== null;
  }

  canReplaceFloorWithWoodenFloor(): boolean {
    return this.floor.canBeReplacedByWoodenFloor();
  }

  canPlaceBlock(): boolean {
    return this.floor.canSupportBlock() && !this.block;
  }

  replaceFloor(floor: Floor): void {
    this.floor.destroy();
    this.floor = floor;
    this.bindInputToFloor();
  }

  setBlock(block: Block): boolean {
    if (this.block) {
      return false;
    }

    this.block = block;
    return true;
  }

  clearBlock(block?: Block): void {
    if (block && this.block !== block) {
      return;
    }

    this.block = null;
  }

  destroyBlock(): Block | null {
    if (!this.block) {
      return null;
    }

    const oldBlock = this.block;
    this.block = null;
    oldBlock.destroy();

    return oldBlock;
  }

  onPointerDown(callback: (pointer: Phaser.Input.Pointer, tile: Tile) => void): void {
    this.pointerDownCallbacks.push(callback);
  }

  onPointerOver(callback: (tile: Tile) => void): void {
    this.pointerOverCallbacks.push(callback);
  }

  onPointerOut(callback: (tile: Tile) => void): void {
    this.pointerOutCallbacks.push(callback);
  }

  private bindInputToFloor(): void {
    const floorObj = this.floor.getGameObject();

    floorObj.removeAllListeners('pointerdown');
    floorObj.removeAllListeners('pointerover');
    floorObj.removeAllListeners('pointerout');

    floorObj.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      for (const callback of this.pointerDownCallbacks) {
        callback(pointer, this);
      }
    });

    floorObj.on('pointerover', () => {
      for (const callback of this.pointerOverCallbacks) {
        callback(this);
      }
    });

    floorObj.on('pointerout', () => {
      for (const callback of this.pointerOutCallbacks) {
        callback(this);
      }
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

  isVisible(): boolean {
    return this.rect.visible;
  }

  showAt(tile: Tile): void {
    const tileObj = tile.getFloorGameObject();

    this.rect.setPosition(tileObj.x, tileObj.y);
    this.rect.setVisible(true);
    this.rect.body.updateFromGameObject();
  }

  hide(): void {
    this.rect.setVisible(false);
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
  private hoveredTile: Tile | null = null;
  private isInvalidPlacement = false;
  private mode: GameMode = 'normal';
  private selectedBuildItem: BuildItem = 'wooden_floor';

  readonly blockGroup: Phaser.Physics.Arcade.StaticGroup;
  readonly hoverBox: HoverBox;

  constructor(
    private scene: Phaser.Scene,
    private effects: GameEffects,
    private inventory: Inventory,
    private ui: GameUI,
  ) {
    this.blockGroup = this.scene.physics.add.staticGroup();
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

  getHoveredTile(): Tile | null {
    return this.hoveredTile;
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
  }

  setSelectedBuildItem(item: BuildItem): void {
    this.selectedBuildItem = item;
  }

  updatePlacementState(player: Player): void {
    this.isInvalidPlacement =
      this.hoverBox.isVisible() &&
      this.scene.physics.overlap(player.getSprite(), this.hoverBox.getGameObject());
  }

  private createTileFromId(col: number, row: number, tileId: TileId): void {
    let floor: Floor;
    let shouldPlaceTree = false;

    switch (tileId) {
      case 0:
        floor = new WaterFloor(this.scene, col, row);
        break;

      case 1:
      case 4:
        floor = new GrassFloor(this.scene, col, row);
        break;

      case 2:
        floor = new GrassFloor(this.scene, col, row);
        shouldPlaceTree = true;
        break;

      case 3:
        floor = new GrassFloor(this.scene, col, row);
        this.playerSpawnPosition = { x: col, y: row };
        break;

      default:
        throw new Error(`Unknown tile id: ${tileId}`);
    }

    const tile = new Tile(this.scene, col, row, floor);

    this.registerTileEvents(tile);

    if (shouldPlaceTree) {
      this.placeInitialTree(tile);
    }

    this.tiles.push(tile);
  }

  private registerTileEvents(tile: Tile): void {
    tile.onPointerDown((pointer, selectedTile) => {
      this.handleTileClick(pointer, selectedTile);
    });

    tile.onPointerOver((selectedTile) => {
      this.hoveredTile = selectedTile;
      this.hoverBox.showAt(selectedTile);
    });

    tile.onPointerOut((selectedTile) => {
      if (this.hoveredTile === selectedTile) {
        this.hoveredTile = null;
      }

      this.hoverBox.hide();
    });
  }

  private placeInitialTree(tile: Tile): void {
    const tree = new TreeBlock(
      this.scene,
      this.effects,
      this.inventory,
      this.ui.inventoryUI,
      tile.gridX,
      tile.gridY,
      this.blockGroup,
      (block) => {
        tile.clearBlock(block);
      },
    );

    tile.setBlock(tree);
  }

  private handleTileClick(pointer: Phaser.Input.Pointer, tile: Tile): void {
    if (this.mode !== 'build') {
      return;
    }

    if (pointer.leftButtonDown()) {
      this.tryBuild(tile);
      return;
    }

    if (pointer.rightButtonDown()) {
      this.tryBreakBlock(tile);
    }
  }

  private tryBuild(tile: Tile): void {
    if (this.selectedBuildItem === 'wooden_floor') {
      this.tryPlaceWoodenFloor(tile);
      return;
    }

    if (this.selectedBuildItem === 'wooden_block') {
      this.tryPlaceWoodenBlock(tile);
    }
  }

  private tryPlaceWoodenFloor(tile: Tile): void {
    if (
      tile.hasBlock() ||
      !tile.canReplaceFloorWithWoodenFloor() ||
      this.inventory.getWoodCount() === 0
    ) {
      return;
    }

    tile.replaceFloor(new WoodenFloor(this.scene, tile.gridX, tile.gridY));
    this.inventory.removeWood(1);
  }

  private tryPlaceWoodenBlock(tile: Tile): void {
    if (
      !tile.canPlaceBlock() ||
      this.isInvalidPlacement ||
      this.inventory.getWoodCount() === 0
    ) {
      return;
    }

    const block = new WoodenBlock(
      this.scene,
      tile.gridX,
      tile.gridY,
      this.blockGroup,
      (destroyedBlock) => {
        tile.clearBlock(destroyedBlock);
      },
    );

    tile.setBlock(block);
    this.inventory.removeWood(1);
  }

  private tryBreakBlock(tile: Tile): void {
    const block = tile.getBlock();

    if (!block || !block.canBeBrokenByBuildTool()) {
      return;
    }

    this.effects.breaking(block.getGameObject());
    tile.destroyBlock();

    this.inventory.addWood(1);
    this.effects.shake(this.ui.inventoryUI.getTextObject());
  }
}

class GameManager {
  private inputManager!: InputManager;
  private effects!: GameEffects;
  private inventory!: Inventory;
  private ui!: GameUI;
  private world!: GameWorld;
  private player!: Player;
  private mode: GameMode = 'normal';

  constructor(private scene: Phaser.Scene) {}

  create(): void {
    this.scene.input.mouse?.disableContextMenu();
    this.scene.input.setTopOnly(false);

    this.setTextureFilters();

    this.inputManager = new InputManager(this.scene);
    this.effects = new GameEffects(this.scene);
    this.inventory = new Inventory();
    this.ui = new GameUI(this.scene, this.inventory);
    this.world = new GameWorld(this.scene, this.effects, this.inventory, this.ui);

    this.registerInputActions();

    const playerSpawn = this.world.build();
    this.player = new Player(this.scene, this.inputManager, playerSpawn);

    this.scene.physics.add.collider(this.player.getSprite(), this.world.blockGroup);

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
    if (this.inputManager.isResetPressed()) {
      resetGame();
      return;
    }

    this.player.update();
    this.world.updatePlacementState(this.player);
  }

  private registerInputActions(): void {
    this.inputManager.onToggleBuild(() => {
      this.toggleBuildMode();
    });

    this.inputManager.onSelectWoodenFloor(() => {
      if (this.mode !== 'build') {
        return;
      }

      this.ui.buildUI.selectItem('wooden_floor');
      this.world.setSelectedBuildItem(this.ui.getSelectedBuildItem());
    });

    this.inputManager.onSelectWoodenBlock(() => {
      if (this.mode !== 'build') {
        return;
      }

      this.ui.buildUI.selectItem('wooden_block');
      this.world.setSelectedBuildItem(this.ui.getSelectedBuildItem());
    });
  }

  private toggleBuildMode(): void {
    this.mode = this.mode === 'build' ? 'normal' : 'build';

    this.ui.setMode(this.mode);
    this.world.setMode(this.mode);
    this.world.setSelectedBuildItem(this.ui.getSelectedBuildItem());
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
