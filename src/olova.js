/**
 * Olova.js - A simple component framework
 */

// Mount a component to a DOM element
export function mount(componentMount, selector, props = {}) {
  const targetElement = document.querySelector(selector);
  if (targetElement) {
    // Clear the target element
    targetElement.innerHTML = "";

    // Mount the component with props
    const unmount = componentMount(targetElement, props);

    // Return the unmount function
    return unmount;
  } else {
    console.error(`Target element "${selector}" not found`);
    return () => {};
  }
}
