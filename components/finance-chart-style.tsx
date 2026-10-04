export const chartTooltipStyle={border:'1px solid #e5eaf1',borderRadius:12,background:'rgba(255,255,255,.98)',boxShadow:'0 8px 28px #24375114',padding:'12px 15px',fontSize:12,lineHeight:1.7};
export const chartTooltipLabelStyle={color:'#8591a1',fontSize:11,marginBottom:4};

export function ChartEndpoint({cx,cy,color}:{cx?:number;cy?:number;color:string}){
 if(cx==null||cy==null)return null;
 return <g pointerEvents="none"><circle className="chart-endpoint-halo" cx={cx} cy={cy} r={7} fill={color} fillOpacity={.12}/><circle className="chart-endpoint" cx={cx} cy={cy} r={3.5} fill="white" stroke={color} strokeWidth={2}/></g>;
}
