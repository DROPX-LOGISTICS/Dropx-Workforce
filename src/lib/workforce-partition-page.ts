/** Merge disjoint identity partitions without a giant URL or truncating history.
 * Each partition is ordered by day descending, then ID ascending by the loader.
 */
export async function workforcePartitionPage<T extends {id:string;punch_date:string}>(
  partitions: Array<{column:string;ids:string[]}>, page:number,
  load:(partition:{column:string;ids:string[]},from:number,to:number)=>Promise<{rows:T[];total:number}>
) {
  const cursors: Array<{partition:{column:string;ids:string[]};rows:T[];index:number;consumed:number;total:number}> = [];
  for(let start=0;start<partitions.length;start+=4){
    cursors.push(...await Promise.all(partitions.slice(start,start+4).map(async partition=>{
      const result=await load(partition,0,99);
      return {partition,...result,index:0,consumed:0};
    })));
  }
  const total=cursors.reduce((n,c)=>n+c.total,0), rows:T[]=[];
  const compare=(a:T,b:T)=>String(b.punch_date).localeCompare(String(a.punch_date))||a.id.localeCompare(b.id);
  for(let offset=0;offset<Math.min(total,(page+1)*100);offset++){
    const candidates=cursors.filter(c=>c.index<c.rows.length);
    candidates.sort((a,b)=>compare(a.rows[a.index],b.rows[b.index]));
    const cursor=candidates[0];
    if(!cursor)throw new Error('Attendance pagination ended before its recorded count.');
    if(offset>=page*100)rows.push(cursor.rows[cursor.index]);
    cursor.index++;cursor.consumed++;
    if(cursor.index===cursor.rows.length&&cursor.consumed<cursor.total&&offset+1<Math.min(total,(page+1)*100)){
      const result=await load(cursor.partition,cursor.consumed,cursor.consumed+99);
      cursor.rows=result.rows;cursor.index=0;
    }
  }
  return {rows,total,page,hasMore:total>(page+1)*100};
}
