(async () => {
  const rows = Array.from(document.querySelectorAll('.log-entry-row, .logs-row, [role="row"]'));
  const results = rows.map(row => {
    return {
      text: row.innerText,
      html: row.innerHTML
    };
  });
  return results.filter(r => r.text.includes('[GoogleGenerativeAI Error]') || r.text.includes('Contents'));
})()