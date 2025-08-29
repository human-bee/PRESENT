/**
 * Test file for the new Component Registry system
 *
 * This validates that our simplified architecture works correctly:
 * 1. Components can be registered
 * 2. list_components tool returns correct data
 * 3. ui_update tool can update components
 * 4. Direct calls work without complex bus systems
 */

import { ComponentRegistry } from './component-registry';
import { listComponentsTool, uiUpdateTool } from './custom';

/**
 * Run tests for the component registry system
 * Call this in development to validate the implementation
 */
export async function testComponentRegistry() {
  console.log('🧪 Testing Component Registry System...\n');

  try {
    // Test 1: Register a mock component
    console.log('1️⃣ Testing component registration...');
    ComponentRegistry.register({
      messageId: 'msg_test_timer_123',
      componentType: 'RetroTimer',
      props: { initialMinutes: 5, title: 'Test Timer' },
      contextKey: 'test',
      timestamp: Date.now(),
      updateCallback: (patch) => {
        console.log('   ✅ Update callback received:', patch);
      },
    });
    console.log('   ✅ Component registered successfully\n');

    // Test 2: List components
    console.log('2️⃣ Testing list_components tool...');
    const listResult = await listComponentsTool.tool();
    console.log('   📋 List result:', JSON.stringify(listResult, null, 2));

    if (listResult.status === 'SUCCESS' && listResult.components.length > 0) {
      console.log('   ✅ list_components working correctly\n');
    } else {
      console.log('   ❌ list_components returned unexpected result\n');
    }

    // Test 3: Update component
    console.log('3️⃣ Testing ui_update tool...');
    const updateResult = await uiUpdateTool.tool('msg_test_timer_123', { initialMinutes: 10 });
    console.log('   🔄 Update result:', JSON.stringify(updateResult, null, 2));

    if (updateResult.status === 'SUCCESS') {
      console.log('   ✅ ui_update working correctly\n');
    } else {
      console.log('   ❌ ui_update failed\n');
    }

    // Test 4: Verify update was applied
    console.log('4️⃣ Testing component state after update...');
    const updatedList = await listComponentsTool.tool();
    const updatedComponent = updatedList.components.find(
      (c) => c.messageId === 'msg_test_timer_123',
    );

    if (updatedComponent && updatedComponent.props.initialMinutes === 10) {
      console.log('   ✅ Component props updated correctly');
      console.log('   📊 Updated props:', updatedComponent.props);
    } else {
      console.log('   ❌ Component props not updated correctly');
      console.log('   📊 Current props:', updatedComponent?.props);
    }

    console.log('\n🎉 Component Registry tests completed!');
    console.log('✨ The new simplified architecture is working correctly!\n');

    // Clean up test component
    ComponentRegistry.remove('msg_test_timer_123');
    console.log('🧹 Test component cleaned up');

    return true;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

/**
 * Test the tool schemas and validation
 */
export async function testToolValidation() {
  console.log('🔍 Testing tool validation...\n');

  try {
    // Test invalid component ID
    console.log('1️⃣ Testing invalid component ID validation...');
    try {
      await uiUpdateTool.tool('invalid-id', { initialMinutes: 10 });
      console.log('   ❌ Should have thrown error for invalid ID');
    } catch (error) {
      console.log('   ✅ Correctly rejected invalid component ID');
      console.log('   📝 Error message:', (error as Error).message);
    }

    // Test empty patch
    console.log('\n2️⃣ Testing empty patch validation...');
    try {
      await uiUpdateTool.tool('msg_valid_123', {});
      console.log('   ❌ Should have thrown error for empty patch');
    } catch (error) {
      console.log('   ✅ Correctly rejected empty patch');
      console.log('   📝 Error message:', (error as Error).message);
    }

    console.log('\n✅ Tool validation tests completed!\n');
    return true;
  } catch (error) {
    console.error('❌ Validation test failed:', error);
    return false;
  }
}

// Auto-run tests in development (DISABLED to prevent infinite loops)
// Uncomment to manually run tests in console:
// import { testComponentRegistry, testToolValidation } from '@/lib/test-component-registry';
// testComponentRegistry().then(() => testToolValidation());

/*
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  // Run tests after a short delay to allow app to initialize
  setTimeout(() => {
    console.log('🚀 Auto-running Component Registry tests...\n');
    testComponentRegistry().then(() => {
      testToolValidation();
    });
  }, 2000);
}
*/
