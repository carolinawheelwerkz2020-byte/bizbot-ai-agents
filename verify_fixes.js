(async () => {
  const results = {};

  // 1. Verify Noise Texture
  const noiseEl = document.querySelector('.noise, .grain, [class*="noise"], [class*="grain"]');
  results.noiseTexture = !!noiseEl;
  if (noiseEl) {
    results.noiseDetails = {
      className: noiseEl.className,
      style: window.getComputedStyle(noiseEl).backgroundImage
    };
  }

  // 2. Mobile UI (Viewport should already be 375px)
  const sidebar = document.querySelector('aside');
  const headerBtn = document.querySelector('header button');
  results.initialSidebarVisible = sidebar ? window.getComputedStyle(sidebar).display !== 'none' : false;
  
  if (headerBtn) {
    headerBtn.click();
    await new Promise(r => setTimeout(r, 500));
    results.sidebarVisibleAfterClick = sidebar ? window.getComputedStyle(sidebar).display !== 'none' : false;
  }

  // 3. Chat with Router Agent
  // Find the Router Agent button and click it to open chat
  const routerBtn = Array.from(document.querySelectorAll('button')).find(btn => 
    btn.innerText.includes('Initialize Agent') || btn.closest('div')?.innerText.includes('Router Agent')
  );
  
  if (routerBtn) {
    routerBtn.click();
    await new Promise(r => setTimeout(r, 1000));
    
    // Find chat input
    const input = document.querySelector('textarea, input[type="text"]');
    if (input) {
      input.value = 'Hello Router';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      const sendBtn = document.querySelector('button[type="submit"]') || input.parentElement.querySelector('button');
      if (sendBtn) {
        sendBtn.click();
        await new Promise(r => setTimeout(r, 3000)); // Wait for backend
        
        const messages = Array.from(document.querySelectorAll('.message, [class*="message"]'));
        results.chatResponse = messages.length > 1 ? messages[messages.length - 1].innerText : 'No response';
      }
    } else {
      results.chatError = 'Input not found';
    }
  } else {
    results.chatError = 'Router button not found';
  }

  return results;
})()