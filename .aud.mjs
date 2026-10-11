// 可复用的巡检脚本：滚到底后检查遮挡、越界、点击区。
export const run = async (page, label) => {
  await page.evaluate(() => window.scrollTo(0, 99999));
  await page.waitForTimeout(420);
  const bad = await page.evaluate(() => {
    const tab = document.querySelector('.tabbar');
    const tabTop = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect().top : innerHeight;
    const inScroller = (el) => { let p=el.parentElement; while(p){const o=getComputedStyle(p).overflowX; if(o==='auto'||o==='scroll')return true; p=p.parentElement;} return false; };
    const out = [];
    const vw = innerWidth;
    if (document.documentElement.scrollWidth > vw+1) out.push(`页面横向溢出 ${document.documentElement.scrollWidth}px`);
    for (const el of document.querySelectorAll('button,a,input,select,[role=button]')) {
      const r=el.getBoundingClientRect(), cs=getComputedStyle(el);
      if (cs.display==='none'||cs.visibility==='hidden'||r.width===0) continue;
      if (r.bottom<0||r.top>innerHeight) continue;
      if (inScroller(el)||el.closest('.tabbar')) continue;
      const n=(el.innerText||el.getAttribute('aria-label')||el.placeholder||el.tagName).trim().replace(/\s+/g,' ').slice(0,18);
      if (r.bottom>tabTop+1) out.push(`被底栏遮挡: ${n} (${Math.round(r.bottom-tabTop)}px)`);
      if (r.left<-1) out.push(`超出左边界: ${n} (${Math.round(r.left)}px)`);
      if (r.right>vw+1) out.push(`超出右边界: ${n} (${Math.round(r.right)}px)`);
      if ((r.height<32||r.width<32)&&cs.pointerEvents!=='none'&&!el.closest('.brand')) out.push(`点击区偏小: ${n} (${Math.round(r.width)}x${Math.round(r.height)})`);
    }
    return [...new Set(out)];
  });
  console.log(`\n[${label}]`); console.log(bad.length ? bad.slice(0,8).map(x=>"  ✗ "+x).join("\n") : "  ✓ 无问题");
  return bad;
};
