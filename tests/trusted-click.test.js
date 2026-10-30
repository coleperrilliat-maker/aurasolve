import test from 'node:test';
import assert from 'node:assert/strict';
import {awaitSelection, placeClick, sameDocument} from '../src/background/trusted-click.js';

test('a nested Pearson frame point includes both iframe offsets',()=>{
  const reports=[
    {frameId:0,href:'https://mylab.pearson.com/home',iframes:[{src:'https://tdx.acs.pearson.com/Player/Shell.aspx',left:10,top:20}]},
    {frameId:3,href:'https://tdx.acs.pearson.com/Player/Shell.aspx',iframes:[{src:'Player.aspx',left:4,top:8}]},
    {frameId:7,href:'https://tdx.acs.pearson.com/Player/Player.aspx?q=1',iframes:[]}
  ];
  assert.equal(sameDocument('Player.aspx','https://tdx.acs.pearson.com/Player/Shell.aspx','https://tdx.acs.pearson.com/Player/Player.aspx?q=1'),true);
  assert.deepEqual(placeClick(reports,7,{x:100,y:50}),{x:114,y:78});
});

test('a reason already in the top page keeps its own point',()=>{
  assert.deepEqual(placeClick([{frameId:0,href:'https://example.test/q',iframes:[]}],0,{x:12,y:8}),{x:12,y:8});
});

test('a frame with no matching parent is not clicked in the wrong place',()=>{
  const reports=[
    {frameId:0,href:'https://mylab.pearson.com/home',iframes:[]},
    {frameId:4,href:'https://tdx.acs.pearson.com/Player/Player.aspx',iframes:[]}
  ];
  assert.equal(placeClick(reports,4,{x:10,y:10}),null);
});

test('Pearson player frames line up by iframe id when the launch address differs',()=>{
  const reports=[
    {frameId:0,href:'https://mylab.pearson.com/assignments',iframes:[
      {id:'ctl00_ctl00_InsideForm_MasterContent_PlayerHtml5',name:'',src:'https://launch.pearson.com/go',childHref:'',left:8,top:90}
    ]},
    {frameId:2,href:'https://tdx.acs.pearson.com/Player/Shell.htm',iframes:[
      {id:'activityFrame',name:'activityFrame',src:'about:blank',childHref:'',left:0,top:40}
    ]},
    {frameId:5,href:'https://tdx.acs.pearson.com/Player/Player.aspx?x=1',iframes:[]}
  ];
  assert.deepEqual(placeClick(reports,5,{x:100,y:50}),{x:108,y:180});
});

test('selection is polled until the reason stays, not accepted on the first blank read',async()=>{
  const reads=[
    {filled:false,error:'FL1 did not keep "Given". The box still shows "nothing".'},
    {filled:false,error:'FL1 did not keep "Given". The box still shows "nothing".'},
    {filled:true,label:'Given'}
  ];
  const result=await awaitSelection(()=>reads.shift(), async ()=>{}, 5);
  assert.deepEqual(result,{filled:true,label:'Given'});
  assert.equal(reads.length,0);
});

test('a dropdown that never updates is reported as unselected',async()=>{
  const result=await awaitSelection(async ()=>({filled:false,error:'FL2 did not keep "Definition of midpoint". The box still shows "nothing".'}), async ()=>{}, 3);
  assert.equal(result.filled,false);
  assert.match(result.error,/FL2/);
});
