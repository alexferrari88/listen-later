export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('Hello world from content script');
  },
});