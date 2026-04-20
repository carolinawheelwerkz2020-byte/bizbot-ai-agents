(async () => {
  const elements = Array.from(document.querySelectorAll('*'));
  const target = elements.find(el => el.innerText && el.innerText.includes('[GoogleGenerativeAI Error]'));
  if (target) {
    // Look for the closest log row or just get the parent's text
    return target.innerText;
  }
  return "Not found";
})()