import { _decorator, Component, Node, Vec3, Color, Sprite } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CardUI')
export class CardUI extends Component {
    @property(Node) public frontNode: Node = null!;
    @property(Node) public backNode: Node = null!;
    @property(Node) public shadowNode: Node = null!;

    public type: number = 0; 
    public value: number = 0;
    
    public isSelected: boolean = false; // 仅保留单一的选中状态
    
    // 弹起高度
    private readonly selectOffset: number = 5; 

    // 阴影的配置 (保留原有的优秀视觉细节)
    private readonly normalShadowPos: Vec3 = new Vec3(3, -3, 0);
    private readonly highShadowPos: Vec3 = new Vec3(3, -3, 0); 
    private readonly normalShadowOpacity: number = 150;
    private readonly highShadowOpacity: number = 80; 

    start() {
        this.resetState();
    }

    /** * 切换选中状态：点击卡牌时由 GameManager 调用 
     */
    public toggleSelect() {
        this.isSelected = !this.isSelected;
        
        // 视觉表现：选中则弹起，取消则回落
        const targetY = this.isSelected ? this.selectOffset : 0;
        this.node.setPosition(new Vec3(this.node.position.x, targetY, 0));

        // 同步更新阴影层次感
        this.updateShadowVisual();
    }

    /** * 更新阴影状态 
     */
    private updateShadowVisual() {
        if (!this.shadowNode) return;

        const sprite = this.shadowNode.getComponent(Sprite);
        if (!sprite) return;

        if (this.isSelected) {
            this.shadowNode.setPosition(this.highShadowPos);
            sprite.color = new Color(0, 0, 0, this.highShadowOpacity);
        } else {
            this.shadowNode.setPosition(this.normalShadowPos);
            sprite.color = new Color(0, 0, 0, this.normalShadowOpacity);
        }
    }

    /** * 彻底重置卡牌状态
     * 删除了原有的 isKept 和颜色重置逻辑，只保留坐标和阴影的归位
     */
    public resetState() {
        this.isSelected = false;
        this.node.setPosition(new Vec3(this.node.position.x, 0, 0));
        this.updateShadowVisual();
    }
}