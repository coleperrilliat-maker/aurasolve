let index=0,point=null;
const $=id=>document.getElementById(id);
const questions=[
  '<h2>Solve for x: 3x + 7 = 22.</h2><label>x = <input id="answer" type="text" aria-label="Value of x"></label>',
  '<h2>Which number is a prime number?</h2><label><input name="prime" type="radio" value="9"> 9</label><label><input name="prime" type="radio" value="11"> 11</label><label><input name="prime" type="radio" value="15"> 15</label>',
  '<h2>Plot the point (2, 3) on the coordinate grid.</h2><p>Both axes run from −5 to 5. Each square is one unit. The origin is at the center.</p><div id="graph" class="graph" tabindex="0" aria-label="Coordinate grid: one point" data-aura-graph="point" data-x-min="-5" data-x-max="5" data-y-min="-5" data-y-max="5"></div>',
  '<h2>Drag 8 into the correct category: even or odd.</h2><div id="eight" class="chip" draggable="true" data-aura-draggable aria-label="Number 8">8</div><div id="even" class="drop" data-aura-drop aria-label="Even numbers">Even</div><div id="odd" class="drop" data-aura-drop aria-label="Odd numbers">Odd</div>',
  '<h2>A triangle has angles of 50° and 60°. What is its third angle?</h2><label>Third angle <select id="angle" aria-label="Third angle in degrees"><option value="" disabled selected>Choose</option value="60">60°</option><option value="70">70°</option><option value="80">80°</option></select></label>'
];
function render(){point=null;$("question").innerHTML=questions[index];$("progress").textContent=`QUESTION ${index+1} OF 5`;$("feedback").textContent="";$("next").hidden=true;$("restart").hidden=true;$("submit").hidden=false;
  if(index===2)$("graph").onclick=event=>{const el=$("graph"),r=el.getBoundingClientRect();point=[Math.round((event.clientX-r.left)/r.width*10-5),Math.round(5-(event.clientY-r.top)/r.height*10)];el.dataset.auraPointX=point[0];el.dataset.auraPointY=point[1];el.innerHTML="";const dot=document.createElement("span");dot.className="point";dot.style.left=`${(point[0]+5)*10}%`;dot.style.top=`${(5-point[1])*10}%`;el.append(dot);};
  if(index===3){$("eight").ondragstart=e=>e.dataTransfer.setData("text/plain","eight");for(const id of ["even","odd"]){$(id).ondragover=e=>e.preventDefault();$(id).ondrop=e=>{e.preventDefault();if(e.dataTransfer.getData("text/plain")==="eight")$(id).append($("eight"));};}}
}
$("submit").onclick=()=>{const correct=[()=>$("answer").value.trim()==="5",()=>document.querySelector('input[name="prime"]:checked')?.value==="11",()=>point?.[0]===2&&point?.[1]===3,()=>$("even").contains($("eight")),()=>$("angle").value==="70"][index]();$("feedback").textContent=correct?"Correct! Well done.":"Incorrect. Review your work and try again.";$("next").hidden=!correct||index===4;$("restart").hidden=!correct||index!==4;};
$("next").onclick=()=>{index++;render();};$("restart").onclick=()=>{index=0;render();};
$("graded").onchange=()=>{document.title=$("graded").checked?"Graded assignment":"AuraSolve · Ungraded Practice Lab";$("title").textContent=$("graded").checked?"Graded assessment":"Ungraded practice";document.body.dataset.graded=String($("graded").checked);};
render();
