<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))

useHead(() => ({ title: `clip / ${id.value}` }))
</script>

<template>
  <ClipboardApp :route-id="id" />
</template>
